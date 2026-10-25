/*
 * 聊天指令：订阅一条会话的 SSE，把运行过程翻译成界面消息、思考内容和工具步骤。
 * 发送、继续、停止、审批都在这里发起；历史以 Server 为准，收到 agent-finish 后整条刷新。
 * 调用示例：
 *   await Chat.send(sessionID, '帮我修这个 bug')   // 启动一轮任务，过程走 SSE
 *   await Chat.resume(sessionID)                   // 继续被中断的助手回复
 *   await Chat.stop(sessionID)                     // 停止并刷新到最终状态
 *   Chat.subscribe(sessionID)                      // 打开会话时建立实时连接
 */
import { AgentAPI } from '../api.js'
import { store } from '../store.js'
import { readSSE } from '../utils/sse.js'
import { Session } from './session.js'
import { Tabs } from './tabs.js'                          // 后端起好标题后同步顶部标签文字
import { UI } from './ui.js'
import { t } from '../i18n.js'                            // 工具被拦下等提示需要当前语言文案
import { formatToolOutput, toolStatus } from '../session/tool-ui.js' // 工具状态和结果文本只有一处判断
import { readAttachments } from '../utils/attachments.js'          // 附件大小和类型检查只有一处

const current = () => store.sessions[store.ui.activeSessionID] || null
const streaming = session => session.messages.findLast(message => message.role === 'assistant' && message.isStreaming)

function createAssistant(session) {
  const message = { id: `pending_${crypto.randomUUID()}`, role: 'assistant', content: '', reasoning: '', tools: [], isStreaming: true, startedAt: Date.now(), request: { status: 'running', input: 0, output: 0, cache: 0 } }
  session.messages.push(message)
  return message
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
        try { await Session.refresh(sessionID) } catch { /* Retry the same session after the next backoff. */ }
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
  if (!session || !content.trim() || session.status === 'running') return false
  const provider = store.config.providers[session.provider]
  if (!session.model || !provider?.baseURL || provider.enabled === false) { UI.notify('请先配置并启用此会话使用的模型供应商'); return false }
  const input = content.trim() + session.files.map(file => `\n\n附件 ${JSON.stringify(file.name)}:\n${file.content}`).join('')
  void subscribe(sessionID)
  session.messages.push({ id: `pending_${crypto.randomUUID()}`, role: 'user', content: input })
  createAssistant(session)
  session.status = 'running'
  session.lastEventAt = Date.now()
  Session.syncSummary(session)
  try {
    await AgentAPI.sendMessage(sessionID, input)
    session.files = []
    return true
  } catch (error) {
    const assistant = streaming(session)
    if (assistant) { assistant.error = error.message; assistant.isStreaming = false; assistant.finishedAt = Date.now() }
    session.status = 'idle'
    UI.notify(error.message)
    Session.syncSummary(session)
    return false
  }
}

// 继续被中断的助手：不往时间线塞"继续"用户消息，直接复用当前进度。
async function resume(sessionID) {
  const session = store.sessions[sessionID]
  if (!session || session.status === 'running') return false
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
    UI.notify(error.message)
    return false
  }
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
  }
  if (status) {
    tool.status = status
    if (status !== 'running' && status !== 'waiting') tool.finishedAt = Date.now()
  }
  if (event.input) tool.input = event.input
  if (event.toolName) tool.name = event.toolName
  return tool
}

// --- 运行状态：开始、继续、结束、重试和标题 ---
const RUN_EVENTS = new Set(['agent-start', 'agent-resume', 'llm-finish', 'retry', 'error', 'mcp-error', 'title', 'agent-finish'])
async function receiveRun(sessionID, session, event) {
  if (event.type === 'agent-start') {
    // 后端重连后会把这一轮从头补发一遍，所以只按最后一条用户消息重建这一轮，不信任全局游标。
    const source = await AgentAPI.getSession(sessionID)
    const snapshot = Session.normalize(source, session)
    const lastUser = snapshot.messages.findLastIndex(message => message.role === 'user')
    session.messages = snapshot.messages.slice(0, lastUser + 1) // 这一轮之前的历史不动，只重建当前回答
    createAssistant(session)
    session.status = 'running'
  } else if (event.type === 'agent-resume') {
    // 继续不重置时间线，保留已经看到的进度，只在末尾接一段新的流式回复。
    session.status = 'running'
    session.connection = 'connected'
    if (!streaming(session)) createAssistant(session)
  } else if (event.type === 'llm-finish') {
    const assistant = streaming(session) || createAssistant(session)
    if (event.text) assistant.content = event.text       // 最后一轮正文以完整文本为准
    const usage = event.usage || {}
    assistant.request = { status: 'completed', input: Number(usage.inputTokens || 0), output: Number(usage.outputTokens || 0), cache: Number(usage.cachedInputTokens || 0) }
    session.contextTokens = assistant.request.input + assistant.request.output
    session.inputTokens += assistant.request.input
    session.outputTokens += assistant.request.output
    assistant.isStreaming = false                        // 这一轮回复结束，光标停住
    assistant.finishedAt = Date.now()
  } else if (event.type === 'retry') {
    // 重试也是“正在运行”，即使 agent-start 在断线时丢了，停止按钮也必须出现。
    session.status = 'running'
    const assistant = streaming(session) || createAssistant(session)
    assistant.isStreaming = true
    assistant.retry = `连接重试 ${event.attempt || 1}，请稍候…`
  } else if (event.type === 'error') {
    const assistant = streaming(session) || createAssistant(session)
    assistant.error = event.errorText || event.error?.message || '模型请求失败'
    assistant.isStreaming = false
    assistant.finishedAt = Date.now()
    session.status = 'idle'
    UI.notify(assistant.error)
  } else if (event.type === 'mcp-error') {
    // 某个 MCP 服务没连上；只是跳过它，会话照常，所以提醒一句就好。
    UI.notify(t('mcpFailed', { server: event.server, error: event.error }))
  } else if (event.type === 'title') {
    // 后端起好标题后单独推一条，不用等下一次刷新整条会话。
    session.title = event.title
    Session.syncSummary(session)
    Tabs.syncTitles(Object.values(store.sessions))
  } else if (event.type === 'agent-finish') {
    session.status = 'idle'
    const error = event.error || session.messages.findLast(message => message.error)?.error
    await Session.refresh(sessionID)                     // 最终历史以 Server 写盘的版本为准
    const refreshed = store.sessions[sessionID]
    refreshed.status = 'idle'
    if (error) refreshed.messages.push({ id: `error_${crypto.randomUUID()}`, role: 'assistant', content: '', tools: [], error }) // 每次失败一个独立 id，不用会重复的 SSE 序号
  }
}

// --- 消息内容：正文、思考过程、子任务提示 ---
function receiveMessage(session, event) {
  if (event.type === 'text-delta' || event.type === 'reasoning-delta') {
    const assistant = streaming(session) || createAssistant(session)
    assistant[event.type === 'text-delta' ? 'content' : 'reasoning'] += event.text || event.textDelta || event.delta || ''
  } else if (event.type === 'subagent-tool' || event.type === 'subagent-tool-result') {
    // 子任务在自己的历史里翻文件，这里只显示它在忙什么。
    const assistant = streaming(session) || createAssistant(session)
    assistant.subagent = event.description
  }
}

// --- 工具事件：调用、审批、流式输出、结果 ---
const TOOL_EVENTS = new Set(['tool-call', 'permission', 'tool-output', 'tool-result', 'permission-blocked'])
function receiveTool(session, event) {
  if (event.type === 'tool-call') {
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
    const output = event.output ?? event.result
    const tool = toolFor(session, event, toolStatus(output, event.isError))
    if (tool) {
      tool.output = output
      tool.preview = formatToolOutput(tool.output)
    }
  } else if (event.type === 'permission-blocked') {
    // 这个工具碰到了 .agentignore 护着的文件，已被直接拦下，不用等用户决定。
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
  if (TOOL_EVENTS.has(event.type)) receiveTool(session, event)
  else if (RUN_EVENTS.has(event.type)) await receiveRun(sessionID, session, event)
  else receiveMessage(session, event)                    // 正文增量；不认识的事件自然忽略
  Session.syncSummary(store.sessions[sessionID])
}

async function stop(sessionID) {
  const session = store.sessions[sessionID]
  // 停止是用户动作，先把本地状态收回来：停止按钮立刻消失，重连提示也关掉。
  // SSE 订阅本身会无限重连；不在这里 abort，界面会一直显示“正在重连”。
  if (session) {
    session.status = 'idle'
    session.connection = 'idle'
    const assistant = streaming(session)
    if (assistant) {
      assistant.retry = ''
      assistant.isStreaming = false
      assistant.finishedAt = Date.now()
    }
  }
  unsubscribe(sessionID)
  try {
    await AgentAPI.stopSession(sessionID)
    await Session.refresh(sessionID)
    store.sessions[sessionID].status = 'idle'
    store.sessions[sessionID].connection = 'idle'
    UI.notify('已停止生成')
    return true
  } catch (error) {
    // 停止请求失败时也要刷新，避免界面一直停在“已停止”的假状态。
    try { await Session.refresh(sessionID) } catch { /* 保留原错误提示 */ }
    UI.notify(error.message)
    return false
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
  } catch (error) { UI.notify(error.message); return false }
  finally { tool.deciding = false }
}

async function attach(sessionID, files) {
  const session = store.sessions[sessionID]
  if (!session) return
  const { files: accepted, errors } = await readAttachments(files) // 和草稿页共用同一套检查
  session.files.push(...accepted)                                  // 通过检查的附件跟着会话草稿走
  errors.forEach(message => UI.notify(message))                     // 超限或类型不对的文件逐个提示
}

function removeFile(sessionID, fileID) {
  const session = store.sessions[sessionID]
  if (session) session.files = session.files.filter(file => file.id !== fileID)
}

// --- 回退前先看会改动什么 ---
async function previewRollback(sessionID, messageID) {
  try {
    return await AgentAPI.previewRollback(sessionID, messageID)
  } catch (error) {
    UI.notify(error.message)
    return null
  }
}

async function rollbackMessage(sessionID, messageID, files = true) {
  try {
    const session = store.sessions[sessionID]
    const message = session.messages.find(item => item.id === messageID)
    const result = await AgentAPI.rollback(sessionID, messageID, files)
    await Session.refresh(sessionID)
    // 只有回退到用户消息时才把正文放回输入框；助手回复不是用户的草稿。
    store.sessions[sessionID].draft = message?.role === 'user' ? message.content || '' : ''
    const where = message?.role === 'user' ? '已回退到用户消息之前' : '已回退到助手回复之前'
    UI.notify(result.restored?.length ? `${where}，并恢复 ${result.restored.length} 个文件` : where)
    return true
  } catch (error) { UI.notify(error.message); return false }
}

async function undoRollback(sessionID, files = true) {
  try {
    const result = await AgentAPI.redo(sessionID, files)
    await Session.refresh(sessionID)
    UI.notify(result.restored?.length ? `已撤销回退，并还原 ${result.restored.length} 个文件` : '已撤销回退')
  } catch (error) { UI.notify(error.message) }
}

export const Chat = { current, subscribe, unsubscribe, send, resume, receive, stop, decide, attach, removeFile, previewRollback, rollbackMessage, undoRollback }
