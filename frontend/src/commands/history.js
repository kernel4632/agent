/* 历史记录：读取消息、分组、回退和分支；不依赖页面或 Session。
 * 调用：await History.refresh(id)；History.normalize(response)；await History.rollbackMessage(id, messageId)。
 */
import { AgentAPI } from '../utils/api.js'
import { store } from '../store.js'
import { Notice } from './notice.js'
import { t } from '../utils/i18n.js'
import { formatToolOutput, toolStatus, canonicalToolName, outputText } from './tool.js'
import { requestFromUsage } from './stats.js'
import { DEFAULT_CONTEXT, DEFAULT_SETTINGS } from '../defaults.js'

function partList(item) {
  return Array.isArray(item.parts) ? item.parts
    : (typeof item.content === 'string' ? [{ type: 'text', text: item.content }] : (Array.isArray(item.content) ? item.content : [])) // 兼容 parts 和旧 content 格式
}

function normalizeTool(part) {
  const call = part.toolInvocation || part                // 兼容 UIMessage parts 和旧格式
  const result = call.state === 'result' ? call.result : null // 有结果才判断成功或失败
  const output = result?.output ?? result ?? null
  const status = result ? toolStatus(output, result.isError) : 'running'
  const preview = output ? formatToolOutput(output) : ''
  return { id: call.toolCallId, name: call.toolName, title: call.toolName, input: call.args || call.input || {}, preview, output, status, checkpoint: null }
}

function applyToolResult(messages, parts) {
  for (const result of parts.filter(part => part.type === 'tool-result')) {
    const tool = messages.flatMap(item => item.tools || []).find(item => item.id === result.toolCallId)
    if (!tool) continue
    tool.status = toolStatus(result.output, result.isError) // 拒绝、失败、完成由 tool-ui 统一判断
    tool.output = result.output
    tool.preview = formatToolOutput(result.output)          // 结果文本和实时事件用同一套格式
  }
}

function normalizeRequest(item) {
  return requestFromUsage(item.usage)
}

function normalizeMessage(item, messages) {
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
  if (item.role === 'user') {
    const parsed = splitUserAttachments(message.content) // 历史只保存拼好的输入，附件正文不能进气泡
    message.displayContent = parsed.content              // content 保留完整输入，回退和重新发送仍然可用
    message.attachments = parsed.attachments
  }
  message.tools = parts
    .filter(part => part.type === 'tool-invocation' || part.type === 'tool-call')
    .map(normalizeTool)
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
    const request = normalizeRequest(item)
    if (request) {
      message.request = request
      message.requests = [request]
    }
  }
  return message
}

function normalize(source, previous = {}) {
  const provider = source.provider || findModelProvider(source.model)

  // 阶段一：将 AI SDK 协议消息转换为界面可渲染结构
  // 不保留后端原始 history：它在界面里只通过 messages 使用，留着会多占一倍内存。
  const { history: _history, ...sessionData } = source
  const messages = []                                    // 将 AI SDK 协议消息转换为界面气泡
  for (const item of source.history ?? []) {
    const message = normalizeMessage(item, messages)
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
  const lastRequest = requests.at(-1)
  // 返回前端最终结构，补齐仅前端使用的草稿和用量字段
  return {
    ...sessionData,                                      // 保留公开 Session 身份、工作区、状态和任务
    workspaceID: source.workspaceId,
    // 刷新或重连时以后端真实 running 为准；否则正在重试的会话会显示成空闲，
    // 输入区只剩发送按钮，用户就没法点停止。
    status: source.running ? 'running' : 'idle',
    connection: previous.connection || 'connecting',
    undoable: source.undoable || 0,                      // 还能撤销几次回退，由后端说，刷新页面也不会丢
    // 智能体、能力开关、按用途的模型，后端读取时一并给出。
    // 缺字段时用下面这份兜底；默认值和后端 defaultSettings() 是同一套值（有契约测试盯着）。
    settings: source.settings || previous.settings || {
      ...DEFAULT_SETTINGS,
      capabilities: { ...DEFAULT_SETTINGS.capabilities },
      uses: { ...DEFAULT_SETTINGS.uses },
    },
    title: sessionData.title || previous.title || '',    // 保留已有标题或使用空字符串
    titleGenerated: previous.titleGenerated || (messages.length > 2), // 有历史消息的会话不重复生成标题
    provider,                                           // 模型选择器显示供应商
    model: source.model || store.config.activeModel,    // 模型选择器显示模型
    messages,                                            // 使用合并后的可见消息
    draft: previous.draft || '',                         // 刷新历史不丢失未发送草稿
    files: previous.files || [],                         // 刷新历史不丢失附件元数据
    contextTokens: lastRequest?.input || previous.contextTokens || 0, // 最后一次请求的提示词 token 就是上下文占用
    contextLimit: store.config.providers[provider]?.modelSettings?.[source.model]?.context || previous.contextLimit || DEFAULT_CONTEXT, // 读取模型上下文限制
    inputTokens: requests.length ? sum('input') : previous.inputTokens || 0,       // 历史里的累计输入
    outputTokens: requests.length ? sum('output') : previous.outputTokens || 0,    // 历史里的累计输出
    cacheTokens: requests.length ? sum('cache') : previous.cacheTokens || 0,       // 历史里的缓存读取
  }
}

function findModelProvider(model) {
  const activeProvider = store.config.activeProvider
  if (store.config.providers[activeProvider]?.models?.includes(model)) return activeProvider // 同名模型优先使用当前供应商
  return Object.entries(store.config.providers).find(([, config]) => config.models?.includes(model))?.[0] || activeProvider // 再查找首个配置来源
}

function summaryOf(session) {
  return {
    id: session.id,                                      // 会话唯一身份
    workspaceID: session.workspaceID,                    // 所属工作区
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
  const found = locateSummary(session.id)                       // 查找工作区内摘要
  if (!found) return                                     // 异常游离会话不制造目录项
  Object.assign(found.summary, summaryOf(session))       // 将最新标题、状态、计数和时间写回列表
}

// 摘要和完整历史引用同一会话 ID；只在这里投影，不让历史反向调用会话操作。
function locateSummary(id) {
  for (const workspace of store.workspaces) {
    const summary = workspace.sessions.find(item => item.id === id)
    if (summary) return { workspace, summary }
  }
  return null
}

/** 读取后端真实历史，保留当前草稿、附件和连接状态。 */
async function refresh(id) {
  const settingsAtStart = store.sessions[id]?.settings // 记住本次读取开始时的设置引用
  const source = await AgentAPI.getSession(id)
  const current = store.sessions[id]
  const session = normalize(source, current)
  // 在 GET 途中完成的用户修改比这个快照更新，不能用旧快照覆盖。
  if (current && current.settings !== settingsAtStart) session.settings = current.settings
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
    // 只有回退到用户消息时才把正文放回输入框；助手回复不是用户的草稿。
    store.sessions[sessionID].draft = message?.role === 'user' ? message.content || '' : ''
    const where = message?.role === 'user' ? '已回退到用户消息之前' : '已回退到助手回复之前'
    Notice.show(result.restored?.length ? `${where}，并恢复 ${result.restored.length} 个文件` : where)
    return true
  } catch (error) { Notice.show(error.message); return false }
}

async function undoRollback(sessionID, files = true) {
  try {
    const result = await AgentAPI.redo(sessionID, files)
    await refresh(sessionID)
    Notice.show(result.restored?.length ? `已撤销回退，并还原 ${result.restored.length} 个文件` : '已撤销回退')
  } catch (error) { Notice.show(error.message) }
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

export const isStopTool = tool => STOP_TOOLS.has(canonicalToolName(tool?.name))

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
