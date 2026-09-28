import { AgentAPI } from '../api.js'
import { store } from '../store.js'
import { readSSE } from '../utils/sse.js'
import { Session } from './session.js'
import { UI } from './ui.js'

const current = () => store.sessions[store.ui.activeSessionID] || null
const streaming = session => session.messages.findLast(message => message.role === 'assistant' && message.isStreaming)

function createAssistant(session) {
  const message = { id: `pending_${crypto.randomUUID()}`, role: 'assistant', content: '', reasoning: '', tools: [], isStreaming: true, request: { status: 'running', input: 0, output: 0, cache: 0 } }
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
    session.canRedo = false
    return true
  } catch (error) {
    const assistant = streaming(session)
    if (assistant) { assistant.error = error.message; assistant.isStreaming = false }
    session.status = 'idle'
    UI.notify(error.message)
    Session.syncSummary(session)
    return false
  }
}

function toolFor(session, event, status) {
  const id = event.toolCallId || event.callID || event.callId
  if (!id) return null
  let tool = session.messages.flatMap(message => message.tools || []).find(item => item.id === id)
  if (!tool) {
    const assistant = streaming(session) || createAssistant(session)
    tool = { id, name: event.toolName || event.tool || '工具', input: event.input || {}, preview: '', status }
    assistant.tools.push(tool)
  }
  if (status) tool.status = status
  if (event.input) tool.input = event.input
  if (event.toolName) tool.name = event.toolName
  return tool
}

function outputText(output) {
  if (output == null) return ''
  if (typeof output === 'string') return output
  return typeof output.value === 'string' ? output.value : JSON.stringify(output.value ?? output, null, 2)
}

async function receive(sessionID, event) {
  const session = store.sessions[sessionID]
  if (!session) return
  session.lastEventAt = Date.now()
  if (event.type === 'agent-start') {
    // The existing backend replays the whole in-flight run and resets event IDs
    // after saving. Rebuild only this turn instead of assuming a global cursor.
    const source = await AgentAPI.getSession(sessionID)
    const snapshot = Session.normalize(source, session)
    const lastUser = snapshot.messages.findLastIndex(message => message.role === 'user')
    session.messages = snapshot.messages.slice(0, lastUser + 1)
    createAssistant(session)
    session.status = 'running'
  } else if (event.type === 'text-delta' || event.type === 'reasoning-delta') {
    const assistant = streaming(session) || createAssistant(session)
    assistant[event.type === 'text-delta' ? 'content' : 'reasoning'] += event.text || event.textDelta || event.delta || ''
  } else if (event.type === 'llm-finish') {
    const assistant = streaming(session) || createAssistant(session)
    if (event.text) assistant.content = event.text
    const usage = event.usage || {}
    assistant.request = { status: 'completed', input: Number(usage.inputTokens || 0), output: Number(usage.outputTokens || 0), cache: Number(usage.cachedInputTokens || 0) }
    session.contextTokens = assistant.request.input + assistant.request.output
    session.inputTokens += assistant.request.input
    session.outputTokens += assistant.request.output
    assistant.isStreaming = false
  } else if (event.type === 'tool-call') {
    toolFor(session, event, 'running')
  } else if (event.type === 'permission') {
    toolFor(session, event, 'waiting')
  } else if (event.type === 'tool-output') {
    const tool = toolFor(session, event)
    if (tool) tool.preview += outputText(event.data ?? event.output)
  } else if (event.type === 'tool-result') {
    const tool = toolFor(session, event, event.output?.type === 'execution-denied' ? 'rejected' : event.output?.type === 'error-text' || event.isError ? 'error' : 'completed')
    if (tool) tool.preview = outputText(event.output ?? event.result)
  } else if (event.type === 'retry') {
    const assistant = streaming(session) || createAssistant(session)
    assistant.retry = `连接重试 ${event.attempt || 1}，请稍候…`
  } else if (event.type === 'error') {
    const assistant = streaming(session) || createAssistant(session)
    assistant.error = event.errorText || event.error?.message || '模型请求失败'
    assistant.isStreaming = false
    session.status = 'idle'
    UI.notify(assistant.error)
  } else if (event.type === 'agent-finish') {
    session.status = 'idle'
    const error = event.error || session.messages.findLast(message => message.error)?.error
    await Session.refresh(sessionID)
    const refreshed = store.sessions[sessionID]
    refreshed.status = 'idle'
    if (error) refreshed.messages.push({ id: `error_${event.eventID}`, role: 'assistant', content: '', tools: [], error })
    if (refreshed.title === '新对话') {
      const first = refreshed.messages.find(message => message.role === 'user')
      if (first) await Session.rename(sessionID, first.content.split('\n')[0].slice(0, 32))
    }
  }
  Session.syncSummary(store.sessions[sessionID])
}

async function stop(sessionID) {
  try {
    await AgentAPI.stopSession(sessionID)
    await Session.refresh(sessionID)
    store.sessions[sessionID].status = 'idle'
    UI.notify('已停止生成')
    return true
  } catch (error) { UI.notify(error.message); return false }
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
  for (const file of files) {
    if (file.size > 1024 * 1024) { UI.notify(`${file.name} 超过 1 MiB`); continue }
    if (!/\.(txt|md|js|jsx|ts|tsx|json|css|scss|html|vue|py|go|rs|yaml|yml|csv|xml|sh|log)$/i.test(file.name)) { UI.notify('当前支持文本与代码附件，不支持图片或二进制文件'); continue }
    session.files.push({ id: crypto.randomUUID(), name: file.name, content: await file.text() })
  }
}

function removeFile(sessionID, fileID) {
  const session = store.sessions[sessionID]
  if (session) session.files = session.files.filter(file => file.id !== fileID)
}

async function rollbackMessage(sessionID, messageID) {
  try {
    const session = store.sessions[sessionID]
    const message = session.messages.find(item => item.id === messageID)
    await AgentAPI.rollback(sessionID, messageID)
    await Session.refresh(sessionID)
    store.sessions[sessionID].draft = message?.content || ''
    store.sessions[sessionID].canRedo = true
    UI.notify('已回退至此消息之前')
    return true
  } catch (error) { UI.notify(error.message); return false }
}

async function undoRollback(sessionID) {
  try {
    await AgentAPI.redo(sessionID)
    await Session.refresh(sessionID)
    store.sessions[sessionID].canRedo = false
    UI.notify('已恢复对话')
  } catch (error) { UI.notify(error.message) }
}

export const Chat = { current, subscribe, unsubscribe, send, receive, stop, decide, attach, removeFile, rollbackMessage, undoRollback }
