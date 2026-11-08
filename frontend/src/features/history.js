/*
 * 会话历史：把后端协议消息归一化成界面结构，并承担历史读取、回退和分支。
 *
 * 归一化是唯一入口：历史读取和实时事件最后都落成同一种消息结构，
 * 时间线不用区分数据来自哪条路径。会话目录的增删改在 features/session.js。
 *
 * 调用示例：
 *   const session = await History.refresh(sessionId)
 *   await History.rollbackMessage({ sessionId, messageId })
 */

import { AgentAPI } from '../utils/api.js' // 持久化历史与回退接口
import { store } from '../store.js' // 更新当前可见记录和会话摘要
import { Notice } from '../utils/notice.js' // 操作完成或失败的反馈
import { formatToolOutput, toolStatus, outputText, subagentSteps } from '../utils/tool.js' // 历史和实时事件共用工具解释
import { requestFromUsage } from '../utils/usage.js' // 请求统计统一投影
import { DEFAULT_CONTEXT, NEW_SESSION_TITLE } from '../defaults.js' // 默认上下文与默认标题

function partList(item) {
  return Array.isArray(item.parts) ? item.parts
    : (typeof item.content === 'string' ? [{ type: 'text', text: item.content }] : (Array.isArray(item.content) ? item.content : [])) // 兼容 parts 和旧 content 格式
}

function normalizeTool(part, toolTimings = {}) {
  const call = part.toolInvocation || part                // 兼容 UIMessage parts 和旧格式
  const result = call.state === 'result' ? call.result : null // 有结果才判断成功或失败
  const output = result?.output ?? result ?? null
  const status = result ? toolStatus(output, result.isError) : 'running'
  const preview = output ? formatToolOutput(output) : ''
  const timing = toolTimings[call.toolCallId] || {}
  return {
    id: call.toolCallId,
    name: call.toolName,
    title: call.toolName,
    input: call.args || call.input || {},
    preview,
    output,
    status,
    subagentSteps: subagentSteps(output, call.toolCallId),
    checkpoint: null,
    startedAt: Number(timing.startedAt || call.startedAt || 0),
    finishedAt: Number(timing.finishedAt || call.finishedAt || 0),
    durationMs: Number(timing.durationMs || call.durationMs || 0),
  }
}

function applyToolResult(parts, toolIndex) {
  for (const result of parts.filter(part => part.type === 'tool-result')) {
    // 按 toolCallId 直接取：之前每个结果都 flatMap 整段历史再 find，长会话是 O(n²)。
    const tool = toolIndex.get(result.toolCallId)
    if (!tool) continue
    tool.status = toolStatus(result.output, result.isError) // 拒绝、失败、完成由 tool-ui 统一判断
    tool.output = result.output
    tool.preview = formatToolOutput(result.output)          // 结果文本和实时事件用同一套格式
    if (result.startedAt) tool.startedAt = Number(result.startedAt)
    if (result.finishedAt) tool.finishedAt = Number(result.finishedAt)
    if (result.durationMs) tool.durationMs = Number(result.durationMs)
  }
}

function normalizeRequest(item, id) {
  const request = requestFromUsage(item.usage)
  if (request && id) request.id = `request_${id}`
  return request
}

const ATTACHMENT_HEADER = /\n\n附件 ("(?:[^"\\]|\\.)*"):\n/g

/** 附件原文保留在消息记录里；气泡只显示正文和文件名。 */
export function splitUserAttachments(raw) {
  const text = String(raw ?? '')
  const attachments = []
  let first = -1
  ATTACHMENT_HEADER.lastIndex = 0
  for (let match = ATTACHMENT_HEADER.exec(text); match; match = ATTACHMENT_HEADER.exec(text)) {
    if (first < 0) first = match.index
    try {
      const name = JSON.parse(match[1])
      if (typeof name === 'string' && name) attachments.push({ name })
    } catch { /* 不合法的附件名不影响其他消息显示 */ }
  }
  return { content: first >= 0 ? text.slice(0, first).trimEnd() : text, attachments }
}

function normalizeMessage(item, toolTimings, toolIndex) {
  const parts = partList(item)
  // 只保留界面真正会用到的字段；不要整条 structuredClone，旧格式里的 parts 会留下大份副本。
  const message = {
    id: item.messageId || item.id,
    role: item.role,
    startedAt: Number(item.startedAt || 0),
    finishedAt: Number(item.finishedAt || 0),
  }
  if (item.compact) message.compact = true
  if (item.role === 'tool') {
    applyToolResult(parts, toolIndex)
    return null
  }

  message.reasoning = parts.filter(part => part.type === 'reasoning').map(part => part.reasoning || part.text || '').join('') // 合并推理块
  message.content = parts.filter(part => part.type === 'text').map(part => part.text || '').join('') // 合并文本块
  if (item.role === 'user') message.images = parts.filter(part => part.type === 'image' && typeof part.image === 'string').map(part => part.image) // 图片块缩略图
  if (item.role === 'user') {
    const parsed = splitUserAttachments(message.content) // 历史只保存拼好的输入，附件正文不能进气泡
    message.displayContent = parsed.content              // content 保留完整输入，回退和重新发送仍然可用
    message.attachments = parsed.attachments
  }
  message.tools = parts
    .filter(part => part.type === 'tool-invocation' || part.type === 'tool-call')
    .map(part => normalizeTool(part, toolTimings))
  // 工具建好后立刻登记进索引，后面的 tool 结果消息（协议里单独一条）按 ID 直接回填。
  for (const tool of message.tools) toolIndex.set(tool.id, tool)
  // 保留原始 part 顺序：正文、思考和工具必须按模型实际发生的顺序显示。
  message.steps = []
  if (item.role === 'assistant') {
    for (const part of parts) {
      if (part.type === 'reasoning') {
        const text = part.reasoning || part.text || ''
        if (text) message.steps.push({ type: 'reasoning', text })
      } else if (part.type === 'text') {
        if (part.text) message.steps.push({ type: 'text', text: part.text })
      } else if (part.type === 'tool-invocation' || part.type === 'tool-call') {
        const call = part.toolInvocation || part
        if (call.toolCallId) message.steps.push({ type: 'tool', toolId: call.toolCallId })
      }
    }
    // 旧会话没有 parts 顺序时，退回“思考 → 正文 → 工具”的旧顺序。
    if (!message.steps.length) {
      if (message.reasoning) message.steps.push({ type: 'reasoning', text: message.reasoning })
      if (message.content) message.steps.push({ type: 'text', text: message.content })
      for (const tool of message.tools) message.steps.push({ type: 'tool', toolId: tool.id })
    } else {
      // 步骤里已经有思考正文，顶层再留一份只会让长会话多占一倍内存。
      message.reasoning = ''
    }
  }
  // core 的 compact 项是带 compact 标记的 user 消息，也有真实请求用量。
  if (item.role === 'assistant' || item.compact) {
    const request = normalizeRequest(item, item.messageId)
    if (request) {
      message.request = request
      message.requests = [request]
      // 请求行排在这次回复的所有步骤之前，跟实时事件的位置一致。
      if (item.role === 'assistant') message.steps.unshift({ type: 'request', requestId: request.id })
    }
  }
  return message
}

function normalize(source, previous = {}) {
  const provider = source.provider

  // 阶段一：将 AI SDK 协议消息转换为界面可渲染结构
  // 不保留后端原始 history：它在界面里只通过 messages 使用，留着会多占一倍内存。
  const { history: _history, toolTimings: _toolTimings, ...sessionData } = source
  const messages = []                                    // 将 AI SDK 协议消息转换为界面气泡
  // toolCallId -> tool 索引：tool 结果在协议里是单独一条消息，按 ID 回填，一次建好全程复用。
  const toolIndex = new Map()
  for (const item of source.history ?? []) {
    const message = normalizeMessage(item, source.toolTimings || {}, toolIndex)
    if (message) messages.push(message)                  // 用户和助手消息进入可见时间线
  }
  // 刷新页面时，后端会把仍在等待的用户审批放在 source.pending 里。
  // 历史里的工具调用本身只有“调用中”，必须用这份清单把它标回“等待你的许可”，否则按钮会消失。
  for (const pending of source.pending || []) {
    const callID = pending.callID || pending.toolCallId              // 两种字段名都认
    const tool = toolIndex.get(callID)
    if (tool) tool.status = 'waiting'
  }
  // 统计从每条助手消息的请求用量里重新算，刷新后总消耗和上下文不会归零。
  const requests = messages.flatMap(message => message.requests || [])
  const sum = key => requests.reduce((total, item) => total + Number(item[key] || 0), 0)
  const lastRequest = messages.filter(message => !message.compact).flatMap(message => message.requests || []).at(-1)
  // 返回前端最终结构，补齐仅前端使用的草稿和用量字段
  return {
    ...sessionData,                                      // 保留公开 Session 身份、工作区、状态和任务
    // 刷新或重连时以后端真实 running 为准；否则正在重试的会话会显示成空闲，
    // 输入区只剩发送按钮，用户就没法点停止。
    status: source.running ? 'running' : 'idle',
    connection: previous.connection || 'connecting',
    eventRevision: previous.eventRevision || 0,
    undoable: source.undoable || 0,                      // 还能撤销几次回退，由后端说，刷新页面也不会丢
    settings: source.settings || previous.settings,      // 会话只保存思考强度
    title: sessionData.title || previous.title || '',    // 保留已有标题或使用空字符串
    titleGenerated: previous.titleGenerated || (messages.length > 2), // 有历史消息的会话不重复生成标题
    provider,                                           // 模型选择器显示供应商
    model: source.model,                                // 不用全局默认模型替换未配置的会话
    messages,                                            // 使用合并后的可见消息
    draft: previous.draft || '',                         // 刷新历史不丢失未发送草稿
    files: previous.files || [],                         // 刷新历史不丢失附件元数据
    contextTokens: lastRequest?.input || previous.contextTokens || 0, // 最后一次请求的提示词 token 就是上下文占用
    contextLimit: store.config.providers[provider]?.models.find(model => model.id === source.model)?.context || DEFAULT_CONTEXT,
    inputTokens: requests.length ? sum('input') : previous.inputTokens || 0,       // 历史里的累计输入
    outputTokens: requests.length ? sum('output') : previous.outputTokens || 0,    // 历史里的累计输出
    cacheTokens: requests.length ? sum('cache') : previous.cacheTokens || 0,       // 历史里的缓存读取
  }
}

function summaryOf(session) {
  return {
    id: session.id,                                      // 会话唯一身份
    cwd: session.cwd,                                    // 会话当前目录
    temporary: session.temporary === true,               // 新会话默认使用的临时工作区
    provider: session.provider,
    title: session.title || NEW_SESSION_TITLE,           // 列表显示标题，空标题使用默认文案
    model: session.model,                                // 当前使用模型
    status: session.status,                              // 运行或空闲状态
    messageCount: session.messages.length,               // 消息数量用于列表摘要展示
    createdAt: session.createdAt,                        // 创建时间
    updatedAt: session.updatedAt,                        // 最近更新时间
    lastActiveAt: session.lastActiveAt,                  // 最近活跃时间
  }
}

function syncSummary(session) {
  const found = store.sessionList.find(item => item.id === session.id)
  if (!found) return                                     // 异常游离会话不制造目录项
  Object.assign(found, summaryOf(session))               // 将最新标题、状态、计数和时间写回列表
}

/** 读取后端真实历史，首屏只取最近一页，向上滚动时再补旧消息。 */
const HISTORY_WINDOW = 200
async function refresh(id) {
  const settingsAtStart = store.sessions[id]?.settings // 记住本次读取开始时的设置引用
  const revisionAtStart = store.sessions[id]?.eventRevision || 0
  const source = await AgentAPI.getSession(id, { historyLimit: HISTORY_WINDOW })
  const current = store.sessions[id]
  const session = normalize(source, current)
  // 在 GET 途中完成的用户修改比这个快照更新，不能用旧快照覆盖。
  if (current && current.settings !== settingsAtStart) session.settings = current.settings
  // GET 期间收到的实时事件比快照更新；保留运行中的增量与请求状态。
  const liveConnected = source.running && current?.connection === 'connected' && current.messages.some(message => message.isStreaming)
  if (current?.status === 'running' && ((current.eventRevision || 0) !== revisionAtStart || liveConnected)) {
    session.messages = current.messages
    session.status = current.status
    session.eventRevision = current.eventRevision
  }
  // 刷新窗口只包含最近一页；已经补进内存的更早历史不能被丢掉。
  if (current && !current.temporaryHistory && Number.isInteger(current.historyStart)
    && Number.isInteger(source.historyStart)
    && current.historyStart < source.historyStart
    && current.messages.length) {
    const incoming = new Set(session.messages.map(message => message.id))
    const older = current.messages.filter(message => !incoming.has(message.id)
      && !String(message.id).startsWith('pending_')
      && !String(message.id).startsWith('error_'))
    if (older.length) {
      session.messages = [...older, ...session.messages]
      session.historyStart = current.historyStart
    }
  }
  session.temporaryHistory = false
  store.sessions[id] = session
  syncSummary(session)
  return session
}

/** 临时从指定位置加载到最新：定位条远跳时用，随后可以连续滚到目标。 */
async function loadFrom(id, index) {
  const session = store.sessions[id]
  if (!session || !Number.isInteger(index) || index < 0) return false
  try {
    const source = await AgentAPI.getSession(id, { historyStart: index })
    const current = store.sessions[id]
    const next = normalize(source, current)
    next.historyStart = Number(source.historyStart) || 0
    next.historyTotal = Number(source.historyTotal) || next.historyStart + next.messages.length
    next.temporaryHistory = true
    store.sessions[id] = next
    syncSummary(next)
    return true
  } catch (error) {
    Notice.show(error.message)
    return false
  }
}

/** 临时打开一段早期历史：定位条点得再远也能先加载目标附近再跳过去。 */
async function loadAround(id, index) {
  const session = store.sessions[id]
  if (!session || !Number.isInteger(index) || index < 0) return false
  try {
    const total = Number(session.historyTotal || 0)
    const before = Math.max(0, Math.min(total || index + 120, index + 120))
    const page = await AgentAPI.getSessionHistory(id, before, 200)
    if (!page?.messages?.length) return false
    const source = {
      id: session.id,
      title: session.title,
      cwd: session.cwd,
      temporary: session.temporary,
      provider: session.provider,
      model: session.model,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      settings: session.settings,
      history: page.messages,
      toolTimings: session.toolTimings || {},
      running: false,
      pending: [],
    }
    const next = normalize(source, { settings: session.settings })
    next.historyStart = page.start
    next.historyTotal = page.total || session.historyTotal
    next.temporaryHistory = true
    store.sessions[id] = next
    syncSummary(next)
    return true
  } catch (error) {
    Notice.show(error.message)
    return false
  }
}

/** 在时间线顶部补一页更早的历史；失败时保持现状。 */
async function loadOlder(id, limit = HISTORY_WINDOW) {
  const session = store.sessions[id]
  if (!session || session.status === 'running') return false
  if (!Number.isInteger(session.historyStart) || session.historyStart <= 0) return false
  try {
    const page = await AgentAPI.getSessionHistory(id, session.historyStart, limit)
    if (!page?.messages?.length || page.start >= session.historyStart) return false
    const source = {
      id: session.id,
      title: session.title,
      cwd: session.cwd,
      temporary: session.temporary,
      provider: session.provider,
      model: session.model,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      settings: session.settings,
      history: page.messages,
      toolTimings: session.toolTimings || {},
      running: false,
      pending: [],
    }
    const older = normalize(source, { settings: session.settings }).messages
    const known = new Set(session.messages.map(message => message.id))
    const fresh = older.filter(message => !known.has(message.id))
    session.historyStart = page.start
    session.historyTotal = page.total || session.historyTotal
    if (!fresh.length) return false
    session.messages = [...fresh, ...session.messages]
    return true
  } catch (error) {
    Notice.show(error.message)
    return false
  }
}

async function previewRollback(sessionID, messageID) {
  try {
    return await AgentAPI.previewRollback(sessionID, messageID)
  } catch (error) {
    Notice.show(error.message)
    return null
  }
}

async function rollbackMessage(sessionID, messageID, files = true) {
  try {
    const session = store.sessions[sessionID]
    const message = session.messages.find(item => item.id === messageID)
    const result = await AgentAPI.rollback(sessionID, messageID, files)
    await refresh(sessionID)
    // 回退成功的反馈由输入框上方的撤销条承担，不再额外弹 Toast。
    store.sessions[sessionID].draft = message?.role === 'user' ? message.content || '' : ''
    store.sessions[sessionID].rollback = {
      where: message?.role === 'user' ? '已回退到用户消息之前' : '已回退到助手回复之前',
      preview: rollbackTextPreview(message),
      files: result.restored?.length || 0,
    }
    return true
  } catch (error) { Notice.show(error.message); return false }
}

async function undoRollback(sessionID, files = true) {
  try {
    await AgentAPI.redo(sessionID, files)
    await refresh(sessionID)
    store.sessions[sessionID].rollback = null
  } catch (error) { Notice.show(error.message) }
}

// 撤销条只展示一行预览；保留原文开头，换行和连续空白压平成一句。
function rollbackTextPreview(message) {
  const text = String(message?.content || '').replace(/\s+/g, ' ').trim()
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

/** 建立分支后返回新 ID；是否打开由用户入口决定。 */
async function fork(id, messageId) {
  try {
    const result = await AgentAPI.forkSession(id, messageId ? { messageId } : {})
    Notice.show('已创建分支')
    return result.sessionId
  } catch (error) { Notice.show(error.message); return null }
}

/** 把后端返回的会话数据归一化并登记：目录有就更新摘要，没有就排到列表首位。 */
function admit(source) {
  const session = normalize(source, store.sessions[source.id])
  store.sessions[session.id] = session
  const found = store.sessionList.find(item => item.id === session.id)
  if (found) Object.assign(found, summaryOf(session))
  else store.sessionList.unshift(summaryOf(session))
  return session
}

export const History = { normalize, admit, refresh, loadOlder, loadFrom, loadAround, summaryOf, syncSummary, previewRollback, rollbackMessage, undoRollback, fork }
