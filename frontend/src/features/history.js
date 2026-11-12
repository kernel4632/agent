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

import { nextTick, reactive } from 'vue'
import { AgentAPI } from '../utils/api.js' // 持久化历史与回退接口
import { store } from '../store.js' // 更新当前可见记录和会话摘要
import { Notice } from '../utils/notice.js' // 操作完成或失败的反馈
import { formatToolOutput, toolStatus, outputText, subagentSteps } from '../utils/tool.js' // 历史和实时事件共用工具解释
import { requestFromUsage } from '../utils/usage.js' // 请求统计统一投影
import { ComposerDraft } from './composer-draft.js'
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
  if (item.role === 'error') {
    // 失败请求也是历史的一部分，但它不是模型消息：投影成一条只带请求行的
    // assistant 占位，RequestStatus 负责展示失败原因。
    const data = item.request && typeof item.request === 'object' ? item.request : {}
    const id = item.messageId || item.id
    const startedAt = Number(data.startedAt || item.startedAt || 0)
    const finishedAt = Number(data.finishedAt || item.finishedAt || 0)
    const request = {
      id: `request_${id}`,
      status: 'failed',
      startedAt,
      finishedAt,
      durationMs: Number(data.durationMs || (finishedAt > startedAt ? finishedAt - startedAt : 0)),
      firstTokenAt: 0,
      firstTokenMs: 0,
      provider: data.provider || '',
      model: data.model || '',
      input: 0, output: 0, cache: 0, cacheWrite: 0, total: 0,
      error: data.error || item.content || '模型请求失败',
    }
    return {
      id,
      role: 'assistant',
      content: '',
      reasoning: '',
      tools: [],
      requests: [request],
      steps: [{ type: 'request', requestId: request.id }],
      startedAt,
      finishedAt,
      failedRequest: true,
    }
  }
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
    // partIndex 指向原始 content 数组；块级回退靠它定位正文/工具调用。
    parts.forEach((part, index) => {
      if (part.type === 'reasoning') {
        const text = part.reasoning || part.text || ''
        if (text) message.steps.push({ type: 'reasoning', text, partIndex: index })
      } else if (part.type === 'text') {
        if (part.text) message.steps.push({ type: 'text', text: part.text, partIndex: index })
      } else if (part.type === 'tool-invocation' || part.type === 'tool-call') {
        const call = part.toolInvocation || part
        if (call.toolCallId) message.steps.push({ type: 'tool', toolId: call.toolCallId, partIndex: index })
      }
    })
    // 旧会话没有 parts 顺序时，退回"思考 → 正文 → 工具"的旧顺序。
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
  const manifest = source.historyManifest || null

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
  // 历史里的工具调用本身只有"调用中"，必须用这份清单把它标回"等待你的许可"，否则按钮会消失。
  for (const pending of source.pending || []) {
    const callID = pending.callID || pending.toolCallId              // 两种字段名都认
    const tool = toolIndex.get(callID)
    if (!tool) continue
    tool.status = 'waiting'
    if (pending.review) tool.review = pending.review                 // 刷新后仍能看到 AI 为什么转人工
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
    titleGenerated: previous.titleGenerated || ((source.historyTotal ?? messages.length) > 2), // 有历史消息的会话不重复生成标题
    provider,                                           // 模型选择器显示供应商
    model: source.model,                                // 不用全局默认模型替换未配置的会话
    messages,                                            // 当前段消息；更早内容按 manifest 展开
    toolTimings: source.toolTimings || previous.toolTimings || {},
    ...(manifest ? {
      historyManifest: manifest,
      segmentMessages: previous.segmentMessages || {},
      historyStats: source.historyStats || previous.historyStats || null,
    } : {
      historyManifest: null,
      segmentMessages: {},
    }),
    historyTotal: source.historyTotal ?? previous.historyTotal ?? messages.length,
    draft: previous.draft || '',                         // 刷新历史不丢失未发送草稿
    files: previous.files || [],                         // 刷新历史不丢失附件元数据
    draftLoaded: previous.draftLoaded || false,           // 是否已从本地 IndexedDB 恢复过
    streamRevision: previous.streamRevision || 0,         // 全会话流式内容序号，工具折叠用
    contextTokens: lastRequest?.input || previous.contextTokens || 0, // 最后一次请求的提示词 token 就是上下文占用
    contextEstimate: source.contextEstimate || previous.contextEstimate || null, // 内核本轮压缩判断的估算值
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
    messageCount: Number.isInteger(session.historyTotal) ? session.historyTotal : session.messages.length, // 窗口加载后仍保留全量消息数
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

/** 读取后端真实历史。
 * showLoading=true 展示加载浮层（首次打开会话用）。
 * force=true 强制全量读（回退、分支等处用）；默认务为增量读。
 */
function nextFrame() {
  return typeof requestAnimationFrame === 'function'
    ? new Promise(resolve => requestAnimationFrame(resolve))
    : Promise.resolve()
}

async function refresh(id, { showLoading = false, force = false } = {}) {
  const current = store.sessions[id]
  const settingsAtStart = current?.settings
  const revisionAtStart = current?.eventRevision || 0
  const loading = showLoading ? reactive({
    active: true,
    sessionId: id,
    phase: 'reading',
    percent: 0,
    bytes: 0,
    totalBytes: 0,
    speed: 0,
    eta: 0,
  }) : null
  if (loading) store.ui.sessionLoading = loading

  try {
    if (loading) loading.percent = 40

    // 增量读：已有内存会话且不强制全量时，只拉最后一条已保存消息之后的新增内容。
    // 效果：28 MB → 几 KB；历史统计由服务端按完整历史算，前端只接收尾巴。
    if (current && !force && current.messages.length > 0) {
      const lastSaved = [...current.messages].reverse().find(m => m.id && !m.id.startsWith('pending_') && !m.id.startsWith('error_'))
      if (lastSaved?.id) {
        const delta = await AgentAPI.getSessionDelta(id, lastSaved.id)
        if (loading) {
          loading.phase = 'parsing'
          loading.percent = Math.max(loading.percent, 94)
          await nextFrame()
        }
        applyDelta(id, delta, { settingsAtStart, revisionAtStart })
        if (loading) {
          loading.phase = 'rendering'
          loading.percent = 99
          await nextTick()
          loading.percent = 100
          await nextFrame(); await nextFrame()
          if (store.ui.sessionLoading === loading) loading.active = false
        }
        return store.sessions[id]
      }
    }

    // 全量读：首次打开、force、内存中没有历史。
    // 有 compact 历史的长会话首次打开用分段模式：只给 manifest + 当前段，旧段点开才读。
    const useSegmented = !current && showLoading
    const source = await (useSegmented ? AgentAPI.getSessionSegmented(id) : AgentAPI.getSession(id))
    if (loading) {
      loading.phase = 'parsing'
      loading.percent = Math.max(loading.percent, 94)
      await nextFrame()
    }
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
    if (loading) {
      loading.phase = 'rendering'
      loading.percent = 99
    }
    // 首次打开时从本地草稿库恢复；已有内存会话不重复读，避免覆盖正在输入的内容。
    if (!current) await ComposerDraft.hydrate(session)
    store.sessions[id] = session
    syncSummary(session)
    if (loading) {
      await nextTick()
      loading.percent = 100
      await nextFrame(); await nextFrame()
      if (store.ui.sessionLoading === loading) loading.active = false
    }
    return session
  } catch (error) {
    if (loading && store.ui.sessionLoading === loading) loading.active = false
    throw error
  }
}

/**
 * 把增量响应合并进内存会话。
 * delta.delta 是增量消息数组，delta.historyStats 等是基于完整历史的统计字段。
 */
function applyDelta(id, delta, { settingsAtStart, revisionAtStart } = {}) {
  const current = store.sessions[id]
  if (!current) return

  // 先建工具索引，增量消息里的 tool-result 可以回填到已有工具上
  const toolIndex = new Map()
  for (const msg of current.messages) for (const tool of (msg.tools || [])) toolIndex.set(tool.id, tool)

  const newMessages = []
  for (const item of (delta.delta || [])) {
    const message = normalizeMessage(item, current.toolTimings || {}, toolIndex)
    if (message) newMessages.push(message)
  }

  // 标记等待审批的工具
  for (const pending of (delta.pending || [])) {
    const callID = pending.callID || pending.toolCallId
    const tool = toolIndex.get(callID)
    if (tool) tool.status = 'waiting'
  }

  // 保留历史中真实落盘的消息，截掉本地临时占位，再拼增量
  const base = current.messages.filter(m => m.id && !m.id.startsWith('pending_') && !m.id.startsWith('error_'))
  current.messages = [...base, ...newMessages]

  // 更新基于完整历史的统计字段（服务端算，前端不重算）
  if (delta.historyTotal != null) current.historyTotal = delta.historyTotal
  if (delta.historyStats) current.historyStats = delta.historyStats
  if (delta.contextEstimate !== undefined) current.contextEstimate = delta.contextEstimate
  if (delta.toolTimings) current.toolTimings = delta.toolTimings
  if (delta.undoable != null) current.undoable = delta.undoable
  if (delta.running != null) current.status = delta.running ? 'running' : 'idle'
  current.updatedAt = delta.updatedAt || current.updatedAt

  syncSummary(current)
}

// 回退代价在本地算：历史全量在内存里，消息条数和工具调用都是现成的。
// 文件部分不在这算——回退结果会带 restored，确认框不再预知。
async function previewRollback(sessionID, messageID) {
  const session = store.sessions[sessionID]
  if (!session) return null
  const index = session.messages.findIndex(message => message.id === messageID)
  if (index < 0) {
    Notice.show('这条消息已经不在当前历史里')
    return null
  }
  const dropped = session.messages.slice(index)
  return {
    messages: dropped.filter(message => message.role !== 'tool').length,
    toolCalls: dropped.flatMap(message => (message.tools || []).map(tool => tool.id)).filter(Boolean),
    files: [],
  }
}

// 回退/撤销只在本地保留一份轻量快照，避免为了撤销再拉完整历史。
const rollbackSnapshots = new Map()

function snapshotBeforeRollback(session) {
  return {
    messages: [...session.messages],
    historyTotal: session.historyTotal,
    undoable: session.undoable,
  }
}

function cutLocalMessages(session, messageID, partIndex) {
  const index = session.messages.findIndex(item => item.id === messageID)
  if (index < 0) return false
  if (partIndex === undefined) {
    session.messages = session.messages.slice(0, index)
    return true
  }
  const target = session.messages[index]
  const steps = (target.steps || []).filter(step => step.partIndex === undefined || step.partIndex < partIndex)
  const toolIds = new Set(steps.filter(step => step.type === 'tool').map(step => step.toolId).filter(Boolean))
  const keepsContent = steps.some(step => step.type === 'text' || step.type === 'reasoning' || step.type === 'tool')
  const next = session.messages.slice(0, index)
  if (keepsContent) {
    next.push({
      ...target,
      steps,
      tools: (target.tools || []).filter(tool => toolIds.has(tool.id)),
      rollbackCut: true,
    })
  }
  session.messages = next
  return true
}

async function rollbackMessage(sessionID, messageID, files = true, partIndex) {
  try {
    const session = store.sessions[sessionID]
    const message = session.messages.find(item => item.id === messageID)
    const before = snapshotBeforeRollback(session)
    const result = await AgentAPI.rollback(sessionID, messageID, files, partIndex, true)
    // 服务端已经写入新历史；这里只做本地截断，不再下载完整历史。
    const cut = cutLocalMessages(session, messageID, partIndex)
    if (!cut) await refresh(sessionID, { force: true })
    session.historyTotal = result.historyTotal ?? session.messages.length
    session.undoable = result.undoable ?? 1
    if (cut) rollbackSnapshots.set(sessionID, before)
    else rollbackSnapshots.delete(sessionID)
    // 回退成功的反馈由输入框上方的撤销条承担，不再额外弹 Toast。
    session.draft = message?.role === 'user' ? message.content || '' : ''
    session.rollback = {
      where: message?.role === 'user' ? '已回退到用户消息之前' : '已回退到助手回复之前',
      preview: rollbackTextPreview(message),
      files: result.restored?.length || 0,
    }
    return true
  } catch (error) { Notice.show(error.message); return false }
}

async function undoRollback(sessionID, files = true) {
  try {
    const session = store.sessions[sessionID]
    const before = rollbackSnapshots.get(sessionID)
    const result = await AgentAPI.redo(sessionID, files, true)
    if (before) {
      session.messages = before.messages
      session.historyTotal = result.historyTotal ?? before.historyTotal
      session.undoable = result.undoable ?? before.undoable
      rollbackSnapshots.delete(sessionID)
    } else {
      await refresh(sessionID, { force: true })
    }
    session.rollback = null
  } catch (error) { Notice.show(error.message) }
}

// 撤销条只展示一行预览；保留原文开头，换行和连续空白压平成一句。
function rollbackTextPreview(message) {
  const text = String(message?.content || '').replace(/\s+/g, ' ').trim()
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

// --- 历史分段：manifest 里的 compact 和按需拉取的段内消息 ---
export function normalizeCompact(item) {
  if (!item) return null
  return normalizeMessage(item, {}, new Map())
}

function normalizeSegment(source, toolTimings) {
  const messages = []
  const toolIndex = new Map()
  // 接口正常返回 messages 数组；旧服务端可能把 { id, messages } 整包塞进来，
  // 这里兼容一层，避免折叠段一跳转就抛 "object is not iterable"。
  const raw = Array.isArray(source) ? source : source?.messages
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.messages) ? raw.messages : []
  for (const item of list) {
    const message = normalizeMessage(item, toolTimings || {}, toolIndex)
    if (message) messages.push(message)
  }
  return messages
}

/** 按需读取一个封存历史段；读过的缓存在 session.segmentMessages，折叠只卸载 DOM。 */
async function loadSegment(sessionID, segmentId) {
  const session = store.sessions[sessionID]
  if (!session || !segmentId) return []
  // 已经加载过的段直接从内存返回，不再请求后端
  if (session.segmentMessages?.[segmentId]) return session.segmentMessages[segmentId]
  const source = await AgentAPI.getSessionSegment(sessionID, segmentId)
  const messages = normalizeSegment(source, session.toolTimings)
  if (!session.segmentMessages) session.segmentMessages = {}
  session.segmentMessages[segmentId] = messages
  return messages
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
  session.draftLoaded = true // 新会话没有历史草稿，后续输入可以直接持久化
  store.sessions[session.id] = session
  const found = store.sessionList.find(item => item.id === session.id)
  if (found) Object.assign(found, summaryOf(session))
  else store.sessionList.unshift(summaryOf(session))
  return session
}

export const History = { normalize, admit, refresh, summaryOf, syncSummary, previewRollback, rollbackMessage, undoRollback, fork, loadSegment, normalizeCompact }

/** 新消息发出后，上一轮回退不能再撤销；顺手清掉本地快照和提示条。 */
export function clearRollback(sessionID) {
  rollbackSnapshots.delete(sessionID)
  const session = store.sessions[sessionID]
  if (!session) return
  session.rollback = null
  session.undoable = 0
}
