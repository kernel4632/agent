/*
 * 聊天指令：订阅一条会话的 SSE，把运行过程翻译成界面消息、思考内容和工具步骤。
 * 发送、继续、停止、审批都在这里发起；历史以 Server 为准，收到 agent-finish 后整条刷新。
 * 调用示例：
 *   await Chat.send(sessionID, '帮我修这个 bug')   // 启动一轮任务，过程走 SSE
 *   await Chat.resume(sessionID)                   // 继续被中断的助手回复
 *   await Chat.stop(sessionID)                     // 停止并刷新到最终状态
 *   Chat.subscribe(sessionID)                      // 打开会话时建立实时连接
 */
import { Notice } from './notice.js'
import { AgentAPI } from '../utils/api.js'
import { store } from '../store.js'
import { readSSE } from '../utils/sse.js'
import { History } from './history.js'
import { t } from '../utils/i18n.js'
import { formatToolOutput, toolStatus } from './tool.js'
import { usageFields } from './stats.js'
import { readAttachments } from './attachment.js'

const current = () => store.sessions[store.ui.activeSessionID] || null
const streaming = session => session.messages.findLast(message => message.role === 'assistant' && message.isStreaming)
const stopping = new Set()                                // 停止请求还没返回的会话，暂时不允许发新消息

function createAssistant(session) {
  const message = { id: `pending_${crypto.randomUUID()}`, role: 'assistant', content: '', reasoning: '', tools: [], steps: [], requests: [], isStreaming: true, startedAt: Date.now(), request: { status: 'running', input: 0, output: 0, cache: 0 } }
  session.messages.push(message)
  return message
}

// --- 把一次模型请求的用量收成界面统一字段 ---
// 服务端已经统一过字段名，这里不重复判断各家模型的原始字段。

function finishRequest(request, usage, durationMs) {
  if (!request) return null
  request.status = 'completed'
  request.finishedAt = Date.now()
  Object.assign(request, usageFields(usage, durationMs ?? request.finishedAt - request.startedAt))
  return request
}

async function subscribe(sessionID) {
  if (store.events.controllers[sessionID]) return
  const controller = new AbortController()
  store.events.controllers[sessionID] = controller
  let failures = 0
  try {
    while (!controller.signal.aborted && store.sessions[sessionID]) {
      try {
        const session = store.sessions[sessionID]
        session.connection = failures ? 'reconnecting' : 'connecting'
        const response = await AgentAPI.subscribeSession(sessionID, controller.signal)
        session.connection = 'connected'
        await readSSE(response, event => receive(sessionID, event))
        if (!controller.signal.aborted) throw new Error('实时连接已断开')
      } catch (error) {
        if (controller.signal.aborted) break
        const session = store.sessions[sessionID]
        if (!session) break
        session.connection = 'reconnecting'
        failures += 1
        await new Promise(resolve => {
          const stop = () => { clearTimeout(timer); resolve() }
          const timer = setTimeout(() => { controller.signal.removeEventListener('abort', stop); resolve() }, Math.min(1000 * failures, 10000))
          controller.signal.addEventListener('abort', stop, { once: true })
        })
        if (controller.signal.aborted) break
        try { await History.refresh(sessionID) } catch { /* Retry the same session after the next backoff. */ }
      }
    }
  } finally {
    if (store.events.controllers[sessionID] === controller) delete store.events.controllers[sessionID]
  }
}

function unsubscribe(sessionID) {
  store.events.controllers[sessionID]?.abort()
  delete store.events.controllers[sessionID]
}

async function send(sessionID, content) {
  const session = store.sessions[sessionID]
  if (!session || !content.trim() || session.status === 'running' || stopping.has(sessionID)) return false
  const provider = store.config.providers[session.provider]
  if (!session.model || !provider?.baseURL || provider.enabled === false) { Notice.show('请先配置并启用此会话使用的模型供应商'); return false }
  const files = session.files || []
  const input = content.trim() + files.map(file => `\n\n附件 ${JSON.stringify(file.name)}:\n${file.content}`).join('')
  void subscribe(sessionID)
  // content 保留完整输入（回退后还能重新发送附件正文），气泡只读 displayContent。
  session.messages.push({
    id: `pending_${crypto.randomUUID()}`,
    role: 'user',
    content: input,
    displayContent: content.trim(),
    attachments: files.map(file => ({ id: file.id, name: file.name })),
  })
  createAssistant(session)
  session.status = 'running'
  session.lastEventAt = Date.now()
  History.syncSummary(session)
  try {
    await AgentAPI.sendMessage(sessionID, input)
    session.files = []
    return true
  } catch (error) {
    const assistant = streaming(session)
    if (assistant) { assistant.error = error.message; assistant.isStreaming = false; assistant.finishedAt = Date.now() }
    session.status = 'idle'
    Notice.show(error.message)
    History.syncSummary(session)
    return false
  }
}

// 继续被中断的助手：不往时间线塞"继续"用户消息，直接复用当前进度。
async function resume(sessionID) {
  const session = store.sessions[sessionID]
  if (!session || session.status === 'running' || stopping.has(sessionID)) return false
  void subscribe(sessionID)
  session.status = 'running'
  session.connection = 'connecting'
  session.lastEventAt = Date.now()
  try {
    await AgentAPI.resumeSession(sessionID)
    return true
  } catch (error) {
    session.status = 'idle'
    session.connection = 'idle'
    Notice.show(error.message)
    return false
  }
}

// --- 把正文/思考增量接在最后一个同类 step 后面；顺序和时间线一致 ---
function appendTextStep(assistant, type, text) {
  if (!text) return
  const last = assistant.steps.at(-1)
  if (last?.type === type) last.text += text
  else assistant.steps.push({ type, text })
}

// --- 找到工具步骤；还没有时补一条 ---
function toolFor(session, event, status) {
  const id = event.toolCallId || event.callID || event.callId
  if (!id) return null
  let tool = session.messages.flatMap(message => message.tools || []).find(item => item.id === id)
  if (!tool) {
    const assistant = streaming(session) || createAssistant(session) // 工具事件也可能先到，保证有承载消息
    tool = { id, name: event.toolName || event.tool || '工具', input: event.input || {}, preview: '', output: null, status, startedAt: Date.now() }
    assistant.tools.push(tool)
    assistant.steps.push({ type: 'tool', toolId: id })               // 工具在时间线里的位置由第一次出现决定
  }
  if (status) {
    tool.status = status
    if (status !== 'running' && status !== 'waiting') tool.finishedAt = Date.now()
  }
  if (event.input) tool.input = event.input
  if (event.toolName) tool.name = event.toolName
  return tool
}

// --- 重连后重建这一轮：只保留最后一条用户消息之前的历史，再接新的回答 ---
async function startRun(sessionID, session) {
  const source = await AgentAPI.getSession(sessionID)
  const snapshot = History.normalize(source, session)
  const lastUser = snapshot.messages.findLastIndex(message => message.role === 'user')
  session.messages = snapshot.messages.slice(0, lastUser + 1)
  createAssistant(session)
  session.status = 'running'
}

// --- 继续不重置时间线，保留已经看到的进度，只在末尾接一段新的流式回复 ---
function resumeRun(session) {
  session.status = 'running'
  session.connection = 'connected'
  if (!streaming(session)) createAssistant(session)
}

// --- 上下文压缩：同样是一次模型请求，在时间线里单独占一行，用户不会觉得界面卡住了 ---
function startCompact(session, event) {
  const assistant = streaming(session) || createAssistant(session)
  const request = {
    id: `compact_${crypto.randomUUID()}`,
    status: 'running',
    startedAt: Number(event.startedAt) || Date.now(),
    firstTokenAt: 0,
    finishedAt: 0, durationMs: 0, input: 0, output: 0, cache: 0, cacheWrite: 0, total: 0,
  }
  assistant.steps.push({ type: 'compact', request })
  assistant.isStreaming = true
}

function finishCompact(session, event) {
  const assistant = streaming(session) || createAssistant(session)
  const step = [...assistant.steps].reverse().find(item => item.type === 'compact' && item.request.status === 'running')
  if (!step) return
  step.request = { ...step.request, status: 'completed', ...usageFields(event.usage, event.durationMs), finishedAt: Date.now() }
}

// --- 模型请求开始：在时间线当前的位置放一条请求行，完成后这一行留在原地显示用量 ---
// 重连/刷新时服务端会重放 llm-start，里面的 startedAt 是原始开始时间，计时不能从 0 重新算。
function startRequest(session, event = {}) {
  const assistant = streaming(session) || createAssistant(session)
  const request = {
    id: `request_${crypto.randomUUID()}`,
    status: 'running',
    startedAt: Number(event.startedAt) || Date.now(),
    firstTokenAt: Number(event.firstTokenAt) || 0,
    finishedAt: 0, durationMs: 0, input: 0, output: 0, cache: 0, cacheWrite: 0, total: 0,
  }
  assistant.requests.push(request)
  assistant.steps.push({ type: 'request', requestId: request.id })
  assistant.request = request
  assistant.isStreaming = true
}

// 收到这次请求的第一个增量后，把“等待第一个字”换成“正在接收回复”。
function markFirstToken(assistant) {
  const request = assistant.requests.findLast(item => item.status === 'running')
  if (request && !request.firstTokenAt) request.firstTokenAt = Date.now()
}

// 服务端在第一个内容增量时补一条事件，重连后能拿回真实的首次响应时间。
function setFirstToken(session, event) {
  const assistant = streaming(session) || createAssistant(session)
  const request = assistant.requests.findLast(item => item.status === 'running')
  if (!request || request.firstTokenAt) return
  request.firstTokenAt = Number(event.firstTokenAt) || Date.now()
}

// --- 模型请求结束：补正文、结算用量，光标停住 ---
function finishRunRequest(session, event) {
  const assistant = streaming(session) || createAssistant(session)
  if (event.text) assistant.content = event.text       // 最后一轮正文以完整文本为准
  if (event.text && !assistant.steps.some(step => step.type === 'text')) {
    assistant.steps.push({ type: 'text', text: event.text }) // 没收到增量时补一条，时间线不能空
  }
  let request = assistant.requests.at(-1)
  // 断线重连可能漏掉 llm-start；只收到 finish 时也补一行，不能把用量丢掉。
  if (!request) {
    request = { id: `request_${crypto.randomUUID()}`, status: 'running', startedAt: assistant.startedAt || Date.now(), finishedAt: 0, durationMs: 0, input: 0, output: 0, cache: 0, cacheWrite: 0, total: 0, firstTokenAt: 0 }
    assistant.requests.push(request)
    assistant.steps.push({ type: 'request', requestId: request.id })
  }
  finishRequest(request, event.usage, event.durationMs)
  assistant.request = request
  session.contextTokens = request?.input || 0
  session.inputTokens += request?.input || 0
  session.outputTokens += request?.output || 0
  assistant.isStreaming = false                        // 这一轮回复结束，光标停住
  assistant.finishedAt = Date.now()
}

// --- 连接重试也要显示停止按钮，agent-start 丢了也不能像卡住 ---
function retryRun(session, event) {
  session.status = 'running'
  const assistant = streaming(session) || createAssistant(session)
  assistant.isStreaming = true
  const retry = `连接重试 ${event.attempt || 1}，请稍候…`
  assistant.retry = retry
  // 重试原因挂在当前请求行上，用户不用再去别处找。
  const request = assistant.requests.findLast(item => item.status === 'running')
  if (request) request.retry = retry
}

// --- 模型报错：结束当前请求，保留错误让用户看到 ---
function failRun(session, event) {
  const assistant = streaming(session) || createAssistant(session)
  const request = assistant.requests.at(-1)
  if (request?.status === 'running') {
    request.status = 'failed'
    request.finishedAt = Date.now()
    request.durationMs = request.finishedAt - request.startedAt
  }
  const message = event.errorText || event.error?.message || '模型请求失败'
  if (request) request.error = message
  assistant.error = message
  assistant.isStreaming = false
  assistant.finishedAt = Date.now()
  session.status = 'idle'
  Notice.show(assistant.error)
}

// --- 后端起好标题后单独推一条，不用等下一次刷新整条会话 ---
function setTitle(session, event) {
  session.title = event.title
  History.syncSummary(session)
}

// --- 这一轮结束：以 Server 写盘的最终历史为准 ---
async function finishRun(sessionID, session, event) {
  session.status = 'idle'
  const error = event.error || session.messages.findLast(message => message.error)?.error
  await History.refresh(sessionID)
  const refreshed = store.sessions[sessionID]
  refreshed.status = 'idle'
  if (error) refreshed.messages.push({ id: `error_${crypto.randomUUID()}`, role: 'assistant', content: '', tools: [], error }) // 每次失败一个独立 id，不用会重复的 SSE 序号
}

// --- 运行状态：开始、继续、结束、重试和标题 ---
const RUN_EVENTS = new Set(['agent-start', 'agent-resume', 'llm-start', 'llm-first-token', 'llm-finish', 'retry', 'error', 'mcp-error', 'permission-limit', 'title', 'agent-finish'])
async function receiveRun(sessionID, session, event) {
  if (event.type === 'agent-start') return startRun(sessionID, session)
  if (event.type === 'agent-resume') return resumeRun(session)
  if (event.type === 'llm-start') return startRequest(session, event)
  if (event.type === 'llm-first-token') return setFirstToken(session, event)
  if (event.type === 'llm-finish') return finishRunRequest(session, event)
  if (event.type === 'retry') return retryRun(session, event)
  if (event.type === 'error') return failRun(session, event)
  if (event.type === 'mcp-error') return Notice.show(t('mcpFailed', { server: event.server, error: event.error })) // 某个 MCP 没连上，提醒一句就好
  if (event.type === 'permission-limit') return Notice.show(event.reason) // 刹车触发，告诉用户为什么又要确认
  if (event.type === 'title') return setTitle(session, event)
  if (event.type === 'agent-finish') return finishRun(sessionID, session, event)
}

// --- 消息内容：正文、思考过程、子任务提示 ---
function receiveMessage(session, event) {
  if (event.type === 'text-delta' || event.type === 'reasoning-delta') {
    const assistant = streaming(session) || createAssistant(session) // 没有流式消息时补一条
    markFirstToken(assistant)                                       // 第一段输出到了，请求行改说正在接收
    const field = event.type === 'text-delta' ? 'content' : 'reasoning' // 正文和思考分开放
    const text = event.text || '' // 服务端只承诺 text 一个字段
    assistant[field] += text                                       // 旧字段继续累计，方便复制和用量展示
    appendTextStep(assistant, event.type === 'text-delta' ? 'text' : 'reasoning', text) // 时间线按事件顺序排
  } else if (event.type === 'subagent-tool' || event.type === 'subagent-tool-result') {
    // 子任务在自己的历史里翻文件，这里只显示它在忙什么。
    const assistant = streaming(session) || createAssistant(session) // 子任务事件也要有承载消息
    assistant.subagent = event.description                             // 只显示一句描述
  }
}

// --- 工具事件：调用、审批、流式输出、结果 ---
const TOOL_EVENTS = new Set(['tool-call', 'permission', 'tool-output', 'tool-result', 'permission-blocked'])
function receiveTool(session, event) {
  if (event.type === 'tool-call') {
    markFirstToken(streaming(session) || createAssistant(session)) // 模型直接给工具调用也算开始输出
    toolFor(session, event, 'running')
  } else if (event.type === 'permission') {
    toolFor(session, event, 'waiting')
  } else if (event.type === 'tool-output') {
    const tool = toolFor(session, event)
    if (tool) {
      const chunk = event.data ?? event.output
      if (chunk != null) tool.output = chunk
      tool.preview += formatToolOutput(chunk)            // 流式片段只追加，不覆盖已经看到的内容
    }
  } else if (event.type === 'tool-result') {
    // 状态和归一化历史共用 toolStatus：拒绝、失败、完成在两条路径上必须一致。
    const output = event.output // 服务端只承诺 output；不再认旧 result 字段
    const tool = toolFor(session, event, toolStatus(output, event.isError))
    if (tool) {
      tool.output = output
      tool.preview = formatToolOutput(tool.output)
    }
  } else if (event.type === 'permission-blocked') {
    // 这个工具调用被服务端的权限规则直接拒绝，不用等用户决定。
    // 卡片要说清原因：用户看不到“谁来问过”，只看到工具没执行会以为是坏了。
    // 结果类型用 execution-denied，和“用户拒绝”走同一条 rejected 判断。
    const tool = toolFor(session, event, 'rejected')
    if (tool) {
      tool.output = { type: 'execution-denied', reason: t('toolBlockedReason', { reason: event.reason }) }
      tool.preview = formatToolOutput(tool.output)
    }
  }
}

// --- 接收一条 SSE 事件：先按业务分成三类，再交给对应函数 ---
async function receive(sessionID, event) {
  const session = store.sessions[sessionID]
  if (!session) return
  session.lastEventAt = Date.now()
  // 压缩的开始和结束要显示成一行；压缩流里的正文增量不能混进回答，仍然直接丢掉。
  if (event.type === 'compact-start') return startCompact(session, event)
  if (event.type === 'compact-finish') return finishCompact(session, event)
  if (event.request === 'compact') return
  if (TOOL_EVENTS.has(event.type)) receiveTool(session, event)
  else if (RUN_EVENTS.has(event.type)) await receiveRun(sessionID, session, event)
  else receiveMessage(session, event)                    // 正文增量；不认识的事件自然忽略
  History.syncSummary(store.sessions[sessionID])
}

async function stop(sessionID) {
  const session = store.sessions[sessionID]
  // 停止是用户动作，先把本地状态收回来：停止按钮立刻消失，重连提示也关掉。
  // SSE 订阅本身会无限重连；不在这里 abort，界面会一直显示“正在重连”。
  stopping.add(sessionID)
  if (session) session.stopping = true                   // 输入框暂时禁用，防止停止请求还没回来又发新消息
  const assistant = session ? streaming(session) : null
  const partial = assistant ? { content: assistant.content, reasoning: assistant.reasoning } : undefined // 把已经流出的半段正文交给服务端保存
  if (session) {
    session.status = 'idle'
    session.connection = 'idle'
    if (assistant) {
      assistant.retry = ''
      assistant.isStreaming = false
      assistant.finishedAt = Date.now()
    }
  }
  unsubscribe(sessionID)
  try {
    await AgentAPI.stopSession(sessionID, partial)
    await History.refresh(sessionID)
    store.sessions[sessionID].status = 'idle'
    store.sessions[sessionID].connection = 'idle'
    Notice.show('已停止生成')
    return true
  } catch (error) {
    // 停止请求失败时也要刷新，避免界面一直停在“已停止”的假状态。
    try { await History.refresh(sessionID) } catch { /* 保留原错误提示 */ }
    Notice.show(error.message)
    return false
  } finally {
    stopping.delete(sessionID)
    if (store.sessions[sessionID]) store.sessions[sessionID].stopping = false
  }
}

async function decide(sessionID, callID, decision) {
  const tool = store.sessions[sessionID]?.messages.flatMap(message => message.tools || []).find(item => item.id === callID)
  if (!tool || tool.deciding || !['deny', 'allow-once', 'always-allow'].includes(decision)) return false
  tool.deciding = true
  try {
    const result = await AgentAPI.decideTool(sessionID, callID, decision === 'always-allow' ? 'allow-always' : decision)
    if (!result.ok) throw new Error('此审批已结束，请刷新会话')
    if (tool) tool.status = decision === 'deny' ? 'rejected' : 'running'
    return true
  } catch (error) { Notice.show(error.message); return false }
  finally { tool.deciding = false }
}

async function attach(sessionID, files) {
  const session = store.sessions[sessionID]
  if (!session) return
  const { files: accepted, errors } = await readAttachments(files) // 和草稿页共用同一套检查
  session.files.push(...accepted)                                  // 通过检查的附件跟着会话草稿走
  errors.forEach(message => Notice.show(message))                     // 超限或类型不对的文件逐个提示
}

function removeFile(sessionID, fileID) {
  const session = store.sessions[sessionID]
  if (session) session.files = session.files.filter(file => file.id !== fileID)
}

// --- 回退前先看会改动什么 ---

export const Chat = { current, subscribe, unsubscribe, send, resume, receive, stop, decide, attach, removeFile }
