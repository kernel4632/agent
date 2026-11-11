/*
 * 聊天指令：订阅一条会话的 SSE，把运行过程翻译成界面消息、思考内容和工具步骤。
 * 发送、继续、停止、审批都在这里发起；历史以 Server 为准，收到 agent-finish 后整条刷新。
 * 调用示例：
 *   await Chat.send(sessionID, '帮我修这个 bug')   // 启动一轮任务，过程走 SSE
 *   await Chat.resume(sessionID)                   // 继续被中断的助手回复
 *   await Chat.stop(sessionID)                     // 停止并刷新到最终状态
 *   Chat.subscribe(sessionID)                      // 打开会话时建立实时连接
 */
import { Notice } from '../utils/notice.js'
import { AgentAPI } from '../utils/api.js'
import { store } from '../store.js'
import { readSSE } from '../utils/sse.js'
import { History, clearRollback } from '../features/history.js'
import { estimateTokens } from '../features/stats.js'
import { Settings } from '../features/settings.js'
import { formatToolOutput, toolStatus, applySubagentEvent, subagentSteps } from '../utils/tool.js'
import { usageFields } from '../utils/usage.js'
import { readAttachments } from '../utils/attachment.js'

const current = () => store.sessions[store.ui.activeSessionID] || null
const streaming = session => session.messages.findLast(message => message.role === 'assistant' && message.isStreaming)
const stopping = new Set()                                // 停止请求还没返回的会话，暂时不允许发新消息

// 本地错误气泡只属于上一轮；重新发送或继续时先清掉，不能让它挂在新请求下面。
function dropLocalErrors(session) {
  if (session) session.messages = session.messages.filter(message => !String(message.id || '').startsWith('error_'))
}
const flushingQueues = new Set()                          // 正在把排队消息送入下一轮的会话

// SSE 兼容旧后端：Error 对象/错误对象不能直接 String() 成 "[object Object]"。
function errorTextOf(value, fallback = '模型请求失败') {
  if (typeof value === 'string' && value.trim() && value !== '[object Object]') return value
  if (value && typeof value === 'object') {
    const text = value.message || value.error || value.responseBody || value.body
    if (typeof text === 'string' && text.trim()) return text
    try {
      const json = JSON.stringify(value)
      if (json && json !== '{}' && json !== 'null') return json
    } catch { /* ignore */ }
  }
  return fallback
}

function createAssistant(session) {
  const message = {
    id: `pending_${crypto.randomUUID()}`, role: 'assistant', content: '', reasoning: '',
    tools: [], steps: [], requests: [], isStreaming: true, startedAt: Date.now(),
    request: { status: 'running', input: 0, output: 0, cache: 0 },
  }
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
  // TPS 只算模型真正展示给用户的内容：正文 + 工具参数，不含 reasoning。
  // 分母也只取“第一段正文/工具参数 → 最后一段正文/工具参数”，
  // 不从请求开始或思考首字算，否则思考越长速度越假。
  const raw = `${request.rawText || ''}${request.rawToolInput || ''}`
  request.rawOutput = estimateTokens(raw)
  const generationMs = request.contentStartedAt && request.lastContentAt
    ? Math.max(0, request.lastContentAt - request.contentStartedAt)
    : 0
  request.generationMs = generationMs
  // 只有一个可见片段时没有可测的生成窗口；不能拿一个瞬时时间戳除出天文数字。
  request.rawTps = generationMs > 0 && (request.contentEvents || 0) >= 2 && request.rawOutput > 0
    ? request.rawOutput / (generationMs / 1000)
    : 0
  return request
}

// 正文和工具参数才是可见输出；reasoning 不算 TPS 的起点或 token。
function markContent(request) {
  if (!request) return
  const now = Date.now()
  if (!request.contentStartedAt) request.contentStartedAt = now
  request.lastContentAt = now
  request.contentEvents = (request.contentEvents || 0) + 1
}

// --- 运行中排队：先记在本地，等这一轮空闲后按顺序发出去 ---
// 队列不写进 history，也不占助手消息；它是纯前端的待发草稿，
// 因此用户可以在真正发出前把它撤回输入框。
function queueFor(sessionID) {
  if (!store.ui.queued[sessionID]) store.ui.queued[sessionID] = []
  return store.ui.queued[sessionID]
}

function enqueue(sessionID, content) {
  const session = store.sessions[sessionID]
  const text = String(content || '').trim()
  if (!session || !text) return null
  const item = {
    id: `queued_${crypto.randomUUID()}`,
    content: text,
    files: [...(session.files || [])],
    createdAt: Date.now(),
  }
  queueFor(sessionID).push(item)
  session.files = []
  return item
}

function withdrawQueued(sessionID, queuedID) {
  const session = store.sessions[sessionID]
  const list = queueFor(sessionID)
  const index = list.findIndex(item => item.id === queuedID)
  if (!session || index < 0) return null
  const [item] = list.splice(index, 1)
  if (item.files?.length) session.files.push(...item.files)
  if (item.content) {
    const draft = String(session.draft || '').trim()
    session.draft = draft ? `${item.content}\n${draft}` : item.content
  }
  return item
}

async function flushQueue(sessionID) {
  const session = store.sessions[sessionID]
  if (!session || session.status === 'running' || stopping.has(sessionID)) return false
  if (flushingQueues.has(sessionID)) return false
  const list = queueFor(sessionID)
  const item = list[0]
  if (!item) return false
  flushingQueues.add(sessionID)
  list.shift()
  try {
    const sent = await send(sessionID, item.content, item.files)
    if (!sent) {
      // 发送失败时把消息放回队首，保留在输入区让用户决定继续等还是撤回。
      list.unshift(item)
      return false
    }
    return true
  } finally {
    flushingQueues.delete(sessionID)
  }
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

async function send(sessionID, content, queuedFiles = null) {
  const session = store.sessions[sessionID]
  if (!session || !content.trim() || session.status === 'running' || session.compacting || stopping.has(sessionID)) return false
  const provider = store.config.providers[session.provider]
  if (!session.model || !provider?.baseURL || provider.enabled === false) { Notice.show('请先配置并启用此会话使用的模型供应商'); return false }
  const files = queuedFiles ?? session.files ?? []
  // 图片附件变成内容块随消息进 history 常驻；能不能发给模型由后端按 capabilities 决定。
  const imageParts = files.filter(file => file.kind === 'image').map(file => ({ type: 'image', image: file.dataUrl }))
  const textFiles = files.filter(file => file.kind !== 'image')
  const text = content.trim() + textFiles.map(file => `\n\n附件 ${JSON.stringify(file.name)}:\n${file.content}`).join('')
  const input = imageParts.length
    ? [...(text.trim() ? [{ type: 'text', text }] : []), ...imageParts]
    : text
  dropLocalErrors(session)
  void subscribe(sessionID)
  // content 保留完整输入（回退后还能重新发送附件正文），气泡只读 displayContent。
  session.messages.push({
    id: `pending_${crypto.randomUUID()}`,
    role: 'user',
    content: input,
    displayContent: content.trim(),
    attachments: files.map(file => ({ id: file.id, name: file.name, kind: file.kind || 'text' })),
    images: files.filter(file => file.kind === 'image').map(file => file.dataUrl),
  })
  createAssistant(session)
  session.status = 'running'
  session.lastEventAt = Date.now()
  History.syncSummary(session)
  try {
    await AgentAPI.sendMessage(sessionID, input)
    if (queuedFiles == null) session.files = []
    clearRollback(sessionID)
    return true
  } catch (error) {
    const assistant = streaming(session)
    if (assistant) {
      assistant.error = error.message
      assistant.isStreaming = false
      assistant.finishedAt = Date.now()
    }
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
  dropLocalErrors(session)
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
  const id = event.toolCallId || event.callID || event.callId || event.id
  if (!id) return null
  let tool = session.messages.flatMap(message => message.tools || []).find(item => item.id === id)
  const eventStartedAt = Number(event.startedAt) || 0
  if (!tool) {
    const assistant = streaming(session) || createAssistant(session) // 工具事件也可能先到，保证有承载消息
    tool = { id, name: event.toolName || event.tool || '工具', input: event.input || {}, preview: '', output: null, status, startedAt: eventStartedAt || Date.now(), finishedAt: 0, durationMs: 0, streamInput: '', assembling: false }
    assistant.tools.push(tool)
    assistant.steps.push({ type: 'tool', toolId: id })               // 工具在时间线里的位置由第一次出现决定
  } else if (eventStartedAt && (event.type === 'tool-call' || !tool.startedAt)) {
    // 参数流阶段的 startedAt 只是“开始拼参数”；真正执行时以服务端的 tool-call 时间为准。
    tool.startedAt = eventStartedAt
  }
  if (status) {
    tool.status = status
    if (status !== 'running' && status !== 'waiting') {
      tool.finishedAt = Number(event.finishedAt) || Date.now()
      tool.durationMs = Number(event.durationMs) || Math.max(0, tool.finishedAt - (Number(tool.startedAt) || tool.finishedAt))
    }
  }
  if (event.input) tool.input = event.input
  if (event.toolName) tool.name = event.toolName
  return tool
}

// --- 重连后重建这一轮：只保留最后一条用户消息之前的历史，再接新的回答 ---
async function startRun(sessionID, session) {
  // 本地发送时已经有流式占位；agent-start 再拉整条历史只会把后面的
  // llm-start 堵在读取流里，长会话尤其明显。外部启动/刷新时才需要重建快照。
  if (streaming(session)) {
    session.status = 'running'
    return
  }
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
  if (event.reason === 'automatic' && Number(event.token) && Number(event.budget)) {
    Notice.show(`上下文估算 ${Math.round(event.token / event.budget * 100)}%，正在压缩后继续`)
  } else if (event.reason === 'overflow-retry') {
    Notice.show('模型报告上下文超长，正在压缩后继续')
  }
  const request = {
    id: `compact_${crypto.randomUUID()}`,
    status: 'running',
    startedAt: Number(event.startedAt) || Date.now(),
    firstTokenAt: 0,
    finishedAt: 0, durationMs: 0, input: 0, output: 0, cache: 0, cacheWrite: 0, total: 0,
    content: '', reasoning: '',
    compactReason: event.reason || '',
    compactToken: Number(event.token) || 0,
    compactBudget: Number(event.budget) || 0,
    compactThreshold: Number(event.compactThreshold) || 0,
    compactRatio: Number(event.ratio) || 0,
    compactChars: Number(event.chars) || 0,
    compactMedia: Number(event.media) || 0,
    compactCalibrated: event.calibrated === true,
  }
  assistant.steps.push({ type: 'compact', request })
  assistant.isStreaming = true
}

function finishCompact(session, event) {
  const assistant = streaming(session) || createAssistant(session)
  const step = [...assistant.steps].reverse().find(item => item.type === 'compact' && item.request.status === 'running')
  if (!step) return
  step.request = {
    ...step.request,
    ...(typeof event.content === 'string' ? { content: event.content } : {}),
    status: 'completed',
    ...usageFields(event.usage, event.durationMs),
    finishedAt: Date.now(),
  }
}

// --- 模型请求开始：在时间线当前的位置放一条请求行，完成后这一行留在原地显示用量 ---
// 重连/刷新时服务端会重放 llm-start，里面的 startedAt 是原始开始时间，计时不能从 0 重新算。
function startRequest(session, event = {}) {
  const assistant = streaming(session) || createAssistant(session)
  // 重试事件已经先建好等待中的行；真正开始请求时复用它，不重复插一行。
  const retryRequest = assistant.requests.findLast(item => item.status === 'running' && item.retryAttempt)
  if (retryRequest) {
    retryRequest.startedAt = Number(event.startedAt) || retryRequest.startedAt
    retryRequest.firstTokenAt = Number(event.firstTokenAt) || 0
    retryRequest.provider = event.provider || retryRequest.provider
    retryRequest.model = event.model || retryRequest.model
    retryRequest.rawText = ''
    retryRequest.rawToolInput = ''
    retryRequest.contentStartedAt = 0
    retryRequest.lastContentAt = 0
    retryRequest.contentEvents = 0
    assistant.request = retryRequest
    assistant.isStreaming = true
    return
  }
  const request = {
    id: `request_${crypto.randomUUID()}`,
    status: 'running',
    startedAt: Number(event.startedAt) || Date.now(),
    firstTokenAt: Number(event.firstTokenAt) || 0,
    provider: event.provider || '', model: event.model || '',
    finishedAt: 0, durationMs: 0, input: 0, output: 0, cache: 0, cacheWrite: 0, total: 0,
    rawText: '', rawToolInput: '', contentStartedAt: 0, lastContentAt: 0, contentEvents: 0,
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
    request = { id: `request_${crypto.randomUUID()}`, status: 'running', startedAt: assistant.startedAt || Date.now(), finishedAt: 0, durationMs: 0, input: 0, output: 0, cache: 0, cacheWrite: 0, total: 0, firstTokenAt: 0, rawText: '', rawToolInput: '', contentStartedAt: 0, lastContentAt: 0, contentEvents: 0 }
    assistant.requests.push(request)
    assistant.steps.push({ type: 'request', requestId: request.id })
  }
  if (event.text && !request.rawText) request.rawText = event.text
  finishRequest(request, event.usage, event.durationMs)
  assistant.request = request
  session.contextTokens = request?.input || 0
  session.inputTokens += request?.input || 0
  session.outputTokens += request?.output || 0
  assistant.isStreaming = false                        // 这一轮回复结束，光标停住
  assistant.finishedAt = Date.now()
}

// --- 模型请求重试：每次重试都是一条新的请求行，旧的失败行留在原地 ---
function retryRun(session, event) {
  session.status = 'running'
  const assistant = streaming(session) || createAssistant(session)
  assistant.isStreaming = true
  const attempt = Math.max(1, Number(event.attempt) || 1)
  const delay = Number(event.delay || 0)
  const wait = delay > 0 ? `，${Math.max(1, Math.round(delay / 1000))}s 后继续` : '，请稍候'
  const retry = `模型请求失败，第 ${attempt} 次自动重试${wait}…`
  const errorText = errorTextOf(event.error ?? event.errorText, '模型请求失败，正在自动重试')

  // 上一次尝试结束：保留它的错误和用量，不能把整行改写成下一次重试。
  const previous = assistant.requests.findLast(item => item.status === 'running') || assistant.requests.at(-1)
  if (previous && previous.status === 'running') {
    previous.status = 'failed'
    previous.finishedAt = Date.now()
    previous.durationMs = previous.finishedAt - (Number(previous.startedAt) || previous.finishedAt)
    previous.error = errorText
  }

  // 下一次尝试另开一行：等待退避、真正开始请求、失败或成功都在这行上发生。
  const request = {
    id: `retry_${crypto.randomUUID()}`,
    status: 'running',
    startedAt: Date.now(),
    firstTokenAt: 0,
    provider: previous?.provider || '',
    model: previous?.model || '',
    finishedAt: 0, durationMs: 0, input: 0, output: 0, cache: 0, cacheWrite: 0, total: 0,
    retry,
    retryAttempt: attempt,
    retryUntil: delay > 0 ? Date.now() + delay : 0,
  }
  assistant.requests.push(request)
  assistant.steps.push({ type: 'request', requestId: request.id })
  assistant.request = request
  assistant.retry = retry
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
  const message = errorTextOf(event.error ?? event.errorText, '模型请求失败')
  if (request) request.error = message
  assistant.error = message
  assistant.isStreaming = false
  assistant.finishedAt = Date.now()
  session.status = 'idle'
  Notice.show(assistant.error)
  void flushQueue(session.id)
}

// --- 后端起好标题后单独推一条，不用等下一次刷新整条会话 ---
function setTitle(session, event) {
  session.title = event.title
  History.syncSummary(session)
}

// --- 这一轮结束：以 Server 写盘的最终历史为准，但把本地失败请求留在最后一轮里 ---
async function finishRun(sessionID, session, event) {
  session.status = 'idle'
  const localMessages = session.messages
  const error = event.error || session.messages.findLast(message => message.error)?.error
  await History.refresh(sessionID)
  const refreshed = store.sessions[sessionID]
  refreshed.status = 'idle'
  if (error) {
    // 只收到 agent-finish 错误时，本地请求行还停在 running；先把它标成失败，
    // 后面才能挂回请求条自己的错误折叠里。
    for (const message of localMessages) {
      if (message.role !== 'assistant') continue
      for (const request of message.requests || []) {
        if (request.status !== 'running') continue
        request.status = 'failed'
        request.error = error
        request.finishedAt = Date.now()
        request.durationMs = Math.max(0, request.finishedAt - Number(request.startedAt || request.finishedAt))
      }
    }
  }
  const failed = localMessages
    .flatMap(message => message.role === 'assistant' ? (message.requests || []) : [])
    .filter(request => request.status === 'failed')
  const target = [...refreshed.messages].reverse().find(message => message.role === 'assistant')
  if (target && failed.length) {
    // 刷新会用磁盘历史重建 messages；失败尝试只存在于前端，重新挂回最后一轮。
    // 错误留在失败请求行自己的 request.error 里，不再额外挂一条消息级错误。
    target.requests = [...(target.requests || []), ...failed]
    target.steps = [...(target.steps || []), ...failed.map(request => ({ type: 'request', requestId: request.id }))]
    target.error = ''
  } else if (error) {
    refreshed.messages.push({ id: `error_${crypto.randomUUID()}`, role: 'assistant', content: '', tools: [], error })
  }
  void flushQueue(sessionID)
}

// --- 运行状态：开始、继续、结束、重试和标题 ---
const RUN_EVENTS = new Set(['agent-start', 'agent-resume', 'llm-start', 'llm-first-token', 'llm-finish', 'retry', 'error', 'mcp-error', 'title', 'agent-finish'])
async function receiveRun(sessionID, session, event) {
  if (event.type === 'agent-start') return startRun(sessionID, session)
  if (event.type === 'agent-resume') return resumeRun(session)
  if (event.type === 'llm-start') return startRequest(session, event)
  if (event.type === 'llm-first-token') return setFirstToken(session, event)
  if (event.type === 'llm-finish') return finishRunRequest(session, event)
  if (event.type === 'retry') return retryRun(session, event)
  if (event.type === 'error') return failRun(session, event)
  if (event.type === 'mcp-error') return Notice.show(`MCP 服务 ${event.server} 没连上：${event.error}`) // 某个 MCP 没连上，提醒一句就好
  if (event.type === 'title') return setTitle(session, event)
  if (event.type === 'agent-finish') return finishRun(sessionID, session, event)
}

// --- 消息内容：正文、思考过程、子任务提示 ---
function findTool(session, id) {
  const walk = tools => {
    for (const tool of tools || []) {
      if (tool.id === id) return tool
      const nested = walk(tool.subagentSteps)
      if (nested) return nested
    }
    return null
  }
  for (const message of session.messages) {
    const found = walk(message.tools)
    if (found) return found
  }
  return null
}

function applyMessageDelta(session, event) {
  const assistant = streaming(session) || createAssistant(session) // 没有流式消息时补一条
  // 全会话共享的流序号：工具结束后的折叠靠它判断“下一段模型内容真的到了”，
  // 即使下一段正文落在另一条 assistant 消息里也能收到。
  session.streamRevision = (session.streamRevision || 0) + 1
  markFirstToken(assistant)                                       // 第一段输出到了，请求行改说正在接收
  const field = event.type === 'text-delta' ? 'content' : 'reasoning' // 正文和思考分开放
  const text = event.text || '' // 服务端只承诺 text 一个字段
  assistant[field] += text                                       // 旧字段继续累计，方便复制和用量展示
  if (event.type === 'text-delta') {
    const request = assistant.requests.at(-1)
    if (request) {
      markContent(request)
      request.rawText = `${request.rawText || ''}${text}`
    }
  }
  appendTextStep(assistant, event.type === 'text-delta' ? 'text' : 'reasoning', text) // 时间线按事件顺序排
}

// 后台标签页不逐条渲染 delta：网络还在收，但 rAF/绘制被节流。
// 这里把连续正文/思考合并成一个字符串，切回前台只触发一次渲染。
const pendingDeltas = new Map()
let visibilityBound = false
const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'
const scheduleFrame = callback => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : setTimeout(callback, 0)

function queueDelta(sessionID, event) {
  if (!visibilityBound) {
    visibilityBound = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') for (const id of [...pendingDeltas.keys()]) flushDeltas(id)
    })
  }
  let queue = pendingDeltas.get(sessionID)
  if (!queue) { queue = []; pendingDeltas.set(sessionID, queue) }
  const last = queue.at(-1)
  if (last && last.type === event.type && last.request === (event.request || '')) last.text += event.text || ''
  else queue.push({ type: event.type, request: event.request || '', text: event.text || '' })
  if (!queue.frame) queue.frame = scheduleFrame(() => flushDeltas(sessionID))
}

function flushDeltas(sessionID) {
  const queue = pendingDeltas.get(sessionID)
  const session = store.sessions[sessionID]
  if (!queue || !session) return
  queue.frame = 0
  const batch = queue.splice(0, queue.length)
  for (const item of batch) {
    if (item.request === 'compact') applyCompactDelta(session, item)
    else applyMessageDelta(session, item)
  }
  History.syncSummary(session)
  if (queue.length) queue.frame = scheduleFrame(() => flushDeltas(sessionID))
  else pendingDeltas.delete(sessionID)
}

function applyCompactDelta(session, event) {
  const assistant = streaming(session) || createAssistant(session)
  const step = [...assistant.steps].reverse().find(item => item.type === 'compact' && item.request.status === 'running')
  if (!step) return
  const field = event.type === 'text-delta' ? 'content' : 'reasoning'
  step.request[field] = (step.request[field] || '') + (event.text || '')
}

function receiveMessage(session, event) {
  if (event.type === 'text-delta' || event.type === 'reasoning-delta') {
    applyMessageDelta(session, event)
  } else if (event.type === 'subagent-tool' || event.type === 'subagent-tool-result') {
    // 子任务事件挂到发起它的 new_task 工具下面；找不到父节点时宁可只显示描述，也不串到别的工具上。
    const assistant = streaming(session) || createAssistant(session) // 子任务事件也要有承载消息
    const parent = findTool(session, event.taskId)
    if (parent) {
      parent.subagentDescription = event.description || parent.subagentDescription || '子任务'
      applySubagentEvent(parent, event)
    } else {
      assistant.subagent = event.description
    }
  }
}

// --- 工具事件：参数流、调用、审批、流式输出、结果 ---
const TOOL_EVENTS = new Set(['tool-input-start', 'tool-input-delta', 'tool-input-end', 'tool-call', 'permission', 'tool-output', 'tool-result', 'permission-blocked'])
function receiveTool(session, event) {
  if (event.type === 'tool-input-start') {
    // 模型开始拼工具参数：先占一行，别等整个 JSON 收完才出现。
    const tool = toolFor(session, event, 'running')
    if (tool) {
      tool.assembling = true
      tool.streamInput = ''
      markContent(streaming(session)?.requests.at(-1))
    }
  } else if (event.type === 'tool-input-delta') {
    const tool = toolFor(session, event)
    if (tool) {
      tool.assembling = true
      // 只留尾巴，参数可以很长；完整内容由后面的 tool-call 给。
      tool.streamInput = `${tool.streamInput || ''}${event.delta || ''}`.slice(-6000)
      const request = streaming(session)?.requests.at(-1)
      if (request) {
        markContent(request)
        request.rawToolInput = `${request.rawToolInput || ''}${event.delta || ''}`
      }
    }
  } else if (event.type === 'tool-input-end') {
    const tool = toolFor(session, event)
    if (tool) tool.assembling = true
  } else if (event.type === 'tool-call') {
    const tool = toolFor(session, event, 'running') // 模型直接给工具调用也算开始输出
    if (tool) {
      tool.assembling = false
      // 保留最后一段 raw 参数：工具完成到下一次请求之间还要继续显示，
      // 不能在这里清空导致内容先消失、Fold 再收高度。
      const request = streaming(session)?.requests.at(-1)
      if (request) {
        markContent(request)
        if (!request.rawToolInput && event.input) request.rawToolInput = JSON.stringify(event.input)
      }
    }
    markFirstToken(streaming(session) || createAssistant(session))
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
      const nested = subagentSteps(output, tool.id)
      if (nested.length) tool.subagentSteps = nested
    }
  } else if (event.type === 'permission-blocked') {
    // 这个工具调用被服务端的权限规则直接拒绝，不用等用户决定。
    // 卡片要说清原因：用户看不到“谁来问过”，只看到工具没执行会以为是坏了。
    // 结果类型用 execution-denied，和“用户拒绝”走同一条 rejected 判断。
    const tool = toolFor(session, event, 'rejected')
    if (tool) {
      tool.output = { type: 'execution-denied', reason: `已被权限规则拦下（${event.reason}）` }
      tool.preview = formatToolOutput(tool.output)
    }
  }
}

// --- 接收一条 SSE 事件：先按业务分成三类，再交给对应函数 ---
async function receive(sessionID, event) {
  const session = store.sessions[sessionID]
  if (!session) return
  const deltaEvent = event.type === 'text-delta' || event.type === 'reasoning-delta'
  // 工具/请求/结束事件到达前，先把后台积压的正文按顺序落下去。
  if (!deltaEvent) flushDeltas(sessionID)
  session.eventRevision = (session.eventRevision || 0) + 1
  session.lastEventAt = Date.now()
  // 压缩的开始和结束显示成一行；压缩流里的正文留在这一行里实时显示，不进正常回答。
  if (event.type === 'compact-start') return startCompact(session, event)
  if (event.type === 'compact-finish') return finishCompact(session, event)
  if (event.request === 'compact') {
    if (deltaEvent) applyCompactDelta(session, event)
    return
  }
  if (deltaEvent) {
    if (isHidden()) queueDelta(sessionID, event)
    else {
      receiveMessage(session, event)
      History.syncSummary(store.sessions[sessionID])
    }
    return
  }
  if (TOOL_EVENTS.has(event.type)) receiveTool(session, event)
  else if (RUN_EVENTS.has(event.type)) await receiveRun(sessionID, session, event)
  else receiveMessage(session, event)                    // 正文增量；不认识的事件自然忽略
  History.syncSummary(store.sessions[sessionID])
}

async function compact(sessionID) {
  const session = store.sessions[sessionID]
  if (!session || session.status === 'running' || session.compacting || stopping.has(sessionID)) return false
  session.compacting = true
  Notice.show('正在压缩上下文…')
  try {
    await AgentAPI.compactSession(sessionID)
    // 压缩结果由 SSE 的 compact-start / compact-finish 实时更新；这里不再整份
    // 重读历史，否则会话对象被替换，底部统计会在压缩完成后短暂或永久消失。
    Notice.show('上下文已压缩')
    return true
  } catch (error) {
    Notice.show(error.message)
    return false
  } finally {
    if (store.sessions[sessionID]) store.sessions[sessionID].compacting = false
  }
}

async function stop(sessionID) {  const session = store.sessions[sessionID]
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
    void flushQueue(sessionID)
  }
}

// --- 审批决定由 features/approval.js 承担；这里只保留 SSE 接收和任务编排 ---

async function attach(sessionID, files, options = {}) {
  const session = store.sessions[sessionID]
  if (!session) return
  const { files: accepted, errors } = await readAttachments(files) // 和草稿页共用同一套检查
  session.files.push(...accepted)                                  // 通过检查的附件跟着会话草稿走
  errors.forEach(message => Notice.show(message))                     // 超限或类型不对的文件逐个提示
  // 粘贴图片时按当前模型能力提醒一次；不影响粘贴和发送本身。
  if (options?.pasted && accepted.some(file => file.kind === 'image')) {
    imagePasteNotice({ hasImage: true, provider: session.provider, model: session.model })
  }
}

function removeFile(sessionID, fileID) {
  const session = store.sessions[sessionID]
  if (session) session.files = session.files.filter(file => file.id !== fileID)
}

// --- 回退前先看会改动什么 ---

// --- 这台模型配置里有没有开图片输入 ---
export function hasImageCapability(provider, model) {
  const config = store.config.providers[provider]
  const entry = (config?.models || []).find(item => item.id === model)
  return Boolean(entry?.capabilities?.includes('image'))
}

// --- 直接给这台模型补上 image 能力并保存配置 ---
// 设置草稿已打开时改草稿并 autoSave；否则用 open() 建出同一份草稿再改，不碰用户正在编辑的界面状态。
async function enableImage(provider, model) {
  if (!store.settings.draft) Settings.open()
  const draft = store.settings.draft
  const entry = (draft.providers || []).find(item => item.name === provider)
  if (!entry) { Notice.show('找不到这个供应商的配置'); return false }
  const modelEntry = (entry.models || []).find(item => item.id === model)
  if (!modelEntry) { Notice.show('找不到这个模型的配置'); return false }
  if (Array.isArray(modelEntry.capabilities)) {
    if (!modelEntry.capabilities.includes('image')) modelEntry.capabilities.push('image')
  } else {
    modelEntry.capabilities = ['text', 'image']
  }
  await Settings.autoSave()
  return true
}

/**
 * 粘贴图片后按当前模型能力提醒一次。
 * 有能力就不打扰；没能力弹一条带按钮的提示，不影响粘贴本身。
 */
export function imagePasteNotice({ hasImage, provider, model }) {
  if (!hasImage) return
  if (hasImageCapability(provider, model)) return
  Notice.show({
    message: `${model} 没有开启图片输入，模型看不到这张图。确认它有多模态能力的话，`,
    action: { label: '打开图片输入', run: async () => {
      const done = await enableImage(provider, model)
      Notice.show(done ? `已为 ${model} 打开图片输入，下一轮请求生效` : '没能打开图片输入，请到设置里手动开启')
    } },
  })
}

export const Chat = { current, subscribe, unsubscribe, send, resume, receive, stop, compact, attach, removeFile, enqueue, withdrawQueued, flushQueue, imagePasteNotice }
