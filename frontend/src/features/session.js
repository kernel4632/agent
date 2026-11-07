/*
 * 会话：会话目录、消息历史、回退和分支都在这一份数据里。
 *
 * 会话列表来自 /session/list；完整历史、统计和工具结果只在打开会话时读取。
 * History 负责消息归一化和回退，Session 负责创建、读取、重命名、删除和切换模型。
 * 页面导航属于 commands/navigation.js，不在这里。
 *
 * 调用示例：
 *   const session = await Session.read(sessionId)
 *   const turns = groupMessageTurns(session.messages)
 *   await History.rollbackMessage({ sessionId, messageId })
 */

import { AgentAPI } from '../utils/api.js' // 持久化历史与回退接口
import { store } from '../store.js' // 更新当前可见记录和会话摘要
import { Notice } from '../utils/notice.js' // 操作完成或失败的反馈
import { t } from '../utils/i18n.js' // 共享文案
import { formatToolOutput, toolStatus, outputText, subagentSteps } from '../utils/tool.js' // 历史和实时事件共用工具解释
import { requestFromUsage } from '../utils/usage.js' // 请求统计统一投影
import { DEFAULT_CONTEXT, DEFAULT_SETTINGS, NEW_SESSION_TITLE } from '../defaults.js' // 默认上下文与运行参数

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

function applyToolResult(messages, parts) {
  for (const result of parts.filter(part => part.type === 'tool-result')) {
    const tool = messages.flatMap(item => item.tools || []).find(item => item.id === result.toolCallId)
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

function normalizeMessage(item, messages, toolTimings) {
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
    applyToolResult(messages, parts)
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
  for (const item of source.history ?? []) {
    const message = normalizeMessage(item, messages, source.toolTimings || {})
    if (message) messages.push(message)                  // 用户和助手消息进入可见时间线
  }
  // 刷新页面时，后端会把仍在等待的用户审批放在 source.pending 里。
  // 历史里的工具调用本身只有“调用中”，必须用这份清单把它标回“等待你的许可”，否则按钮会消失。
  for (const pending of source.pending || []) {
    const callID = pending.callID || pending.toolCallId              // 两种字段名都认
    const tool = messages.flatMap(item => item.tools || []).find(item => item.id === callID)
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
    settings: source.settings || previous.settings || { ...DEFAULT_SETTINGS }, // 会话只保存思考强度
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
    title: session.title || t('newConversation'),        // 列表显示标题，空标题使用默认文案
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

/** 读取后端真实历史，保留当前草稿、附件和连接状态。 */
async function refresh(id) {
  const settingsAtStart = store.sessions[id]?.settings // 记住本次读取开始时的设置引用
  const revisionAtStart = store.sessions[id]?.eventRevision || 0
  const source = await AgentAPI.getSession(id)
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
  store.sessions[id] = session
  syncSummary(session)
  return session
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
      preview: rollbackPreview(message),
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
function rollbackPreview(message) {
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



export const STOP_TOOLS = new Set(['attempt_completion', 'ask_followup_question'])

export const isStopTool = tool => STOP_TOOLS.has(tool?.name)

// 状态、输出内容、输出文本都从 tool-ui 来；被拒绝或执行失败的任务不会被当成正常收尾。
export const isFinishedStopTool = tool => isStopTool(tool)
  && tool.status === 'completed'
  && toolStatus(tool.output) === 'completed'
  && Boolean(outputText(tool))

export const hasStopTool = messages => messages.some(message => (message.tools || []).some(isFinishedStopTool))

// 本地占位（pending）和错误气泡没有后端消息 id，不能回退、分支或继续。
export const isSavedMessage = message => Boolean(message?.id) && !message.id.startsWith('pending_') && !message.id.startsWith('error_')

const ATTACHMENT_HEADER = /\n\n附件 ("(?:[^"\\]|\\.)*"):\n/g

/** 按用户消息划分轮次；自动接续的助手消息属于同一轮。 */
export function groupMessageTurns(messages = []) {
  const turns = []
  let assistantTurn = null
  for (const message of messages) {
    if (message.role === 'assistant' && assistantTurn) {
      assistantTurn.messages.push(message)
      continue
    }
    const turn = { id: message.id, role: message.role, messages: [message] }
    turns.push(turn)
    assistantTurn = message.role === 'assistant' ? turn : null
  }
  return turns
}

/** 只有已经落盘、没有正常收尾的最后一轮助手可以继续。 */
export function canContinueSession(session) {
  if (!session || session.status === 'running' || session.stopping) return false
  const turn = groupMessageTurns(session.messages || []).at(-1)
  if (!turn || turn.role !== 'assistant') return false
  return !hasStopTool(turn.messages) && isSavedMessage(turn.messages.at(-1))
}

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

export const History = { normalize, refresh, summaryOf, syncSummary, previewRollback, rollbackMessage, undoRollback, fork }

// --- 会话列表只来自 /session/list，不再拼装独立工作区 ---
function locate(sessionID) {
  return store.sessionList.find(session => session.id === sessionID)
}


// --- 创建会话 ---
async function create(cwd) {
  try {
    const created = await AgentAPI.createSession(cwd, store.config.activeProvider, store.config.activeModel)
    const session = normalize(created)                  // 补齐仅前端使用的草稿和用量字段
    store.sessions[session.id] = session                // 完整会话进入响应式目录
    store.sessionList.unshift(summaryOf(session)) // 摘要进入列表首位
    return session                                      // 返回新会话供组合动作使用
  } catch (error) {
    Notice.show(error.message)                            // 反馈真实创建失败原因
    return null                                         // 保持当前页面和目录不变
  }
}


// --- 重命名会话 ---
async function rename(sessionID, title) {
  const cleanTitle = title.trim()                       // 标题不保留首尾空白
  const found = locate(sessionID)                       // 查找摘要归属
  const session = store.sessions[sessionID]             // 查找完整会话
  if (!cleanTitle || !found) return false
  try {
    const result = await AgentAPI.renameSession(sessionID, cleanTitle)
    found.title = result.title                          // 更新侧边栏摘要
    if (session) session.title = result.title
    return true                                         // 标题编辑器退出编辑
  } catch (error) {
    Notice.show(error.message)                            // 保留编辑器内容并显示错误
    return false                                        // 不伪造保存成功
  }
}


// --- 切换当前会话目录；只改 cwd，历史、模型和设置都不动 ---
async function setCwd(sessionID, cwd) {
  const result = await AgentAPI.setSessionCwd(sessionID, cwd)
  const summary = locate(sessionID)
  if (summary) {
    summary.cwd = result.cwd
    summary.temporary = false
  }
  const session = store.sessions[sessionID]
  if (session) {
    session.cwd = result.cwd
    session.temporary = false
  }
  return result
}

// --- 删除会话 ---
function forget(sessionID) {
  const found = locate(sessionID)
  if (!found) return false
  store.sessionList.splice(store.sessionList.indexOf(found), 1)
  delete store.sessions[sessionID]
  return true
}

async function remove(sessionID) {
  if (!locate(sessionID)) return false
  try {
    await AgentAPI.removeSession(sessionID)
    forget(sessionID)
    if (store.ui.activeSessionID === sessionID) { store.ui.activeSessionID = ''; store.ui.view = 'home' }
    Notice.show(t('sessionDeleted'))
    return true
  } catch (error) {
    Notice.show(error.message)
    return false
  }
}

// 连续删除：逐个调用已有删除接口，失败的保留并提示，成功的立刻从本地列表移除。
async function removeMany(sessionIDs = []) {
  const ids = [...new Set(sessionIDs)].filter(id => locate(id))
  if (!ids.length) return 0
  const activeRemoved = ids.includes(store.ui.activeSessionID)
  let removed = 0
  for (const sessionID of ids) {
    try {
      await AgentAPI.removeSession(sessionID)
      forget(sessionID)
      removed += 1
    } catch (error) {
      Notice.show(error.message)
    }
  }
  if (removed && activeRemoved) { store.ui.activeSessionID = ''; store.ui.view = 'home' }
  if (removed) Notice.show(`已删除 ${removed} 个会话`)
  return removed
}


// --- 切换会话模型 ---
async function selectModel(sessionID, provider, model) {
  const session = store.sessions[sessionID]
  if (!session) return false
  try {
    const meta = await AgentAPI.setSessionModel(sessionID, provider, model)
    session.provider = meta.provider
    session.model = meta.model
    session.contextLimit = store.config.providers[provider]?.models.find(item => item.id === model)?.context || DEFAULT_CONTEXT
    return true
  } catch (error) {
    Notice.show(error.message)                            // 服务端错误直接展示
    return false
  }
}


// --- 改会话运行设置 ---
async function saveSettings(sessionID, change) {
  const session = store.sessions[sessionID]
  if (!session) return null
  // 控件会先亮起来；失败时用这份快照还原，避免界面停在一个后端没接受的值上。
  const previous = session.settings
  const next = { ...previous, ...change }
  session.settings = next
  try {
    const settings = await AgentAPI.saveSettings(sessionID, change)
    // 读取历史可能已经替换会话对象，响应必须写到当前对象，不能写回过期引用。
    const current = store.sessions[sessionID]
    if (current) current.settings = settings
    return settings
  } catch (error) {
    const current = store.sessions[sessionID]
    if (current) current.settings = previous
    Notice.show(error.message)
    return null
  }
}


// --- 改思考强度 ---
// 七档和界面滑块共用；写错的值后端会退回原值。
async function setReasoning(sessionID, reasoning) {
  const session = store.sessions[sessionID]
  if (!session) return null
  return saveSettings(sessionID, { reasoning })
}


/** 读取并登记会话；导航和当前页面由 Navigation 决定。 */
async function read(id) {
  const sessionID = id.trim()
  if (!/^[\w-]+$/.test(sessionID)) { Notice.show('请输入有效的会话 ID'); return false }
  try {
    const session = await refresh(sessionID)
    const found = locate(sessionID)
    if (!session.title && found) session.title = found.title
    if (!found) store.sessionList.unshift(summaryOf(session))
    return session
  } catch (error) { Notice.show(error.message); return false }
}


// --- 加载会话列表 ---
async function list() {
  try {
    const sessions = await AgentAPI.getSessionList()
    store.sessionList = sessions.map(serverSummaryOf) // 空列表就是还没有会话，不依赖工作区初始化
    return true
  } catch (error) {
    // 启动时后端没起来不该在控制台留下未处理的 rejection；用可见的错误提示代替。
    store.ui.errorMessage = error.message
    return false
  }
}

// --- 重新加载会话列表 ---
async function reload() {
  const sessions = await AgentAPI.getSessionList()
  store.sessionList = sessions.map(serverSummaryOf)
  return true
}

// --- 把 Server 会话转换成列表摘要 ---
function serverSummaryOf(session) {
  return {
    id: session.id,
    cwd: session.cwd,
    temporary: session.temporary === true,
    title: session.title || NEW_SESSION_TITLE,
    provider: session.provider,
    model: session.model,
    messageCount: session.messageCount ?? 0,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

export const Session = { locate, list, reload, create, read, rename, remove, removeMany, selectModel, saveSettings, setReasoning, setCwd }
