/*
Session 指令：负责创建、读取、打开、重命名、删除和切换会话模型。
Server 会话会被归一化为现有 M3E 组件可直接渲染的消息与工具结构。
调用示例：await Session.create(workspaceID)、await Session.open(sessionID)。
*/
import { AgentAPI } from '../api.js'                    // 引入正式 Session HTTP 契约
import { store } from '../store.js'                     // 引入工作区摘要与完整会话
import { UI } from '../app/ui.js'                            // 引入导航和反馈指令
import { Tabs } from '../app/tabs.js'                        // 同步顶部会话标签
import { t } from '../i18n.js'                          // 引入当前语言默认文案
import { formatToolOutput, toolStatus } from './tool-ui.js' // 工具状态和文本只有一处判断
import { requestFromUsage } from './usage.js'             // 请求用量字段只有一处转换
import { splitUserAttachments } from '../utils/user-message.js'      // 历史里的附件正文不能跑进用户气泡
import { COMPACT_RANGE, DEFAULT_CONTEXT, DEFAULT_SETTINGS } from '../defaults.js' // 默认值只留一处


// --- 查找会话摘要和所属工作区 ---
function locate(sessionID) {
  for (const workspace of store.workspaces) {
    const summary = workspace.sessions.find((session) => session.id === sessionID) // 在工作区摘要中查找
    if (summary) return { workspace, summary }          // 返回后续修改需要的同一引用
  }
  return null                                           // 未找到时由调用动作决定反馈
}


// --- 记录已打开会话 ---
function rememberOpened(sessionID) {
  const previousIndex = store.ui.openedSessionIDs.indexOf(sessionID) // 查找会话是否已经出现在侧边栏
  if (previousIndex >= 0) store.ui.openedSessionIDs.splice(previousIndex, 1) // 再次打开时先移除旧位置
  store.ui.openedSessionIDs.unshift(sessionID)                        // 最近打开的会话放在侧边栏最前
}


// --- 关闭已打开会话 ---
async function closeOpened(sessionID) {
  const closingIndex = store.ui.openedSessionIDs.indexOf(sessionID)   // 查找要关闭的侧边栏标签位置
  if (closingIndex < 0) return false                                  // 未打开会话无需改变任何页面状态
  const closingActiveChat = store.ui.view === 'chat' && store.ui.activeSessionID === sessionID // 只有当前对话需要切换页面

  store.ui.openedSessionIDs.splice(closingIndex, 1)                   // 关闭标签，不删除 Server 会话和主页摘要
  if (!closingActiveChat) return true                                 // 关闭后台标签时保留当前页面

  const adjacentSessionID = store.ui.openedSessionIDs[closingIndex] || store.ui.openedSessionIDs[closingIndex - 1] // 优先选择右侧标签，再选择左侧标签
  if (adjacentSessionID) await UI.openChat(adjacentSessionID)         // 相邻完整会话已加载，可直接切换
  else await UI.openHome()                                            // 最后一个标签关闭后返回主页
  return true                                                         // 反馈标签关闭与页面切换完成
}


// --- 创建会话 ---
async function create(workspaceID = store.ui.activeWorkspaceID) {
  const workspace = store.workspaces.find((item) => item.id === workspaceID) || store.workspaces[0] // 没有选择时使用首个工作区
  if (!workspace) return null                           // 没有工作区时不能创建归属不明的会话
  try {
    const created = await AgentAPI.createSession(workspace.id, store.config.activeProvider, store.config.activeModel) // Server 创建并持久化完整会话
    const session = normalize(created)                  // 补齐仅前端使用的草稿和用量字段
    store.sessions[session.id] = session                // 完整会话进入响应式目录
    workspace.sessions.unshift(summaryOf(session))      // 摘要进入当前工作区首位
    rememberOpened(session.id)                          // 新会话已经加载，应立即出现在侧边栏
    await UI.openChat(session.id)                       // 新建后等待进入对话页
    return session                                      // 返回新会话供组合动作使用
  } catch (error) {
    UI.notify(error.message)                            // 反馈真实创建失败原因
    return null                                         // 保持当前页面和目录不变
  }
}


// --- 打开会话 ---
async function open(sessionID) {
  const found = locate(sessionID)                       // 确认目录中存在目标会话
  if (!found) return false                              // 无效点击保持当前页面
  try {
    const loaded = await AgentAPI.getSession(sessionID) // 每次打开读取 Server 最新历史和状态
    if (!loaded.title && found.summary.title) loaded.title = found.summary.title // 摘要已有标题时回退使用，防止侧边栏显示空标题
    store.sessions[sessionID] = normalize(loaded, store.sessions[sessionID]) // 保留当前草稿并替换服务数据
    store.ui.activeWorkspaceID = found.workspace.id     // 侧边栏与主页保持正确工作区归属
    rememberOpened(sessionID)                           // 读取成功后才加入侧边栏，失败时不制造空标签
    Tabs.openSession(sessionID, store.sessions[sessionID]?.title || '新会话')
    await UI.openChat(sessionID)                        // 数据就绪后再打开对话页
    return true                                         // 反馈页面已经切换
  } catch (error) {
    UI.notify(error.message)                            // 展示会话读取错误
    return false                                        // 不进入无数据对话页
  }
}


// --- 刷新完整会话 ---
async function refresh(sessionID) {
  const previous = store.sessions[sessionID]            // 保存当前输入草稿和附件
  const loaded = await AgentAPI.getSession(sessionID)   // 从 Server 读取最终持久化历史
  store.sessions[sessionID] = normalize(loaded, previous) // 写回统一前端结构
  syncSummary(store.sessions[sessionID])                // 同步主页和侧栏摘要
  return store.sessions[sessionID]                      // 反馈最新会话供事件终态使用
}


// --- 重命名会话 ---
async function rename(sessionID, title) {
  const cleanTitle = title.trim()                       // 标题不保留首尾空白
  const found = locate(sessionID)                       // 查找摘要归属
  const session = store.sessions[sessionID]             // 查找完整会话
  if (!cleanTitle || !found) return false
  try {
    const result = await AgentAPI.renameSession(sessionID, cleanTitle)
    found.summary.title = result.title                  // 更新侧边栏和主页摘要
    if (session) session.title = result.title
    const tab = store.tabs.items.find(item => item.sessionID === sessionID)
    if (tab) Tabs.setTitle(tab.key, result.title)
    return true                                         // 标题编辑器退出编辑
  } catch (error) {
    UI.notify(error.message)                            // 保留编辑器内容并显示错误
    return false                                        // 不伪造保存成功
  }
}


// --- 删除会话 ---
function forget(sessionID) {
  const found = locate(sessionID)
  if (!found) return false
  found.workspace.sessions.splice(found.workspace.sessions.indexOf(found.summary), 1)
  delete store.sessions[sessionID]
  const openedIndex = store.ui.openedSessionIDs.indexOf(sessionID)
  if (openedIndex >= 0) store.ui.openedSessionIDs.splice(openedIndex, 1)
  Tabs.removeSession(sessionID)
  return true
}

async function remove(sessionID) {
  if (!locate(sessionID)) return false
  try {
    await AgentAPI.removeSession(sessionID)
    forget(sessionID)
    if (store.ui.activeSessionID === sessionID) await UI.openHome()
    UI.notify(t('sessionDeleted'))
    return true
  } catch (error) {
    UI.notify(error.message)
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
      UI.notify(error.message)
    }
  }
  if (removed && activeRemoved) await UI.openHome()
  if (removed) UI.notify(`已删除 ${removed} 个会话`)
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
    session.contextLimit = store.config.providers[provider]?.modelSettings?.[model]?.context || session.contextLimit || DEFAULT_CONTEXT
    UI.notify(`已切到 ${meta.model}`)
    return true
  } catch (error) {
    UI.notify(error.message)                            // 运行中冲突等错误直接展示
    return false
  }
}


// --- 从当前会话分出一个新分支 ---
async function fork(sessionID, messageId) {
  const session = store.sessions[sessionID]
  if (!session) return null
  try {
    const { sessionId } = await AgentAPI.forkSession(sessionID, messageId ? { messageId } : {})
    await openByID(sessionId)
    UI.notify('已创建分支')
    return sessionId
  } catch (error) {
    UI.notify(error.message)
    return null
  }
}


// --- 改会话运行设置 ---
async function saveSettings(sessionID, change) {
  const session = store.sessions[sessionID]
  if (!session) return null
  // 控件会先亮起来；失败时用这份快照还原，避免界面停在一个后端没接受的值上。
  const previous = session.settings
  const next = { ...previous, ...change }
  if (change.capabilities) next.capabilities = { ...previous.capabilities, ...change.capabilities }
  if (change.uses) next.uses = { ...previous.uses, ...change.uses }
  session.settings = next
  try {
    const settings = await AgentAPI.saveSettings(sessionID, change)
    session.settings = settings                             // 后端说的是准的，本地不自己拼
    return settings
  } catch (error) {
    session.settings = previous
    UI.notify(error.message)
    return null
  }
}


// --- 直接切到指定智能体（输入框上的智能体抽屉用） ---
async function setAgent(sessionID, agent) {
  const session = store.sessions[sessionID]
  if (!session) return null
  const agents = store.config.agents || []
  const next = agents.find(item => item.name === agent)
  if (!next) return null
  if (session.settings.agent === next.name) return session.settings
  const settings = await saveSettings(sessionID, { agent: next.name })
  // 切到只读智能体时要说清会发生什么，不然用户会疑惑"工具怎么少了一半"。
  if (settings) UI.notify(next.readOnly ? `已切到${next.label}：只保留只读工具` : `已切到${next.label}`)
  return settings
}


// --- 智能体在界面上叫什么 ---
function agentLabel(name) {
  return (store.config.agents || []).find(item => item.name === name)?.label || name
}


// --- 切换一项模型能力开关 ---
async function toggleCapability(sessionID, name) {
  const session = store.sessions[sessionID]
  if (!session) return null
  return saveSettings(sessionID, { capabilities: { [name]: !session.settings.capabilities[name] } })
}


// --- 切换自动生成标题 ---
async function toggleAutoTitle(sessionID) {
  const session = store.sessions[sessionID]
  if (!session) return null
  const next = !session.settings.autoTitle
  return saveSettings(sessionID, { autoTitle: next })
}


// --- 改某一件事用的模型 ---
// target 传 null 表示改回和主模型共用（后端认这个意思）。
async function setUse(sessionID, use, target) {
  const session = store.sessions[sessionID]
  if (!session) return null
  // 只提交点名的这一件事，另外两件后端会保持原样。
  const settings = await saveSettings(sessionID, { uses: { [use]: target } })
  if (settings) UI.notify(target ? `「${useLabel(use)}」改用 ${target.model}` : `「${useLabel(use)}」改回和主模型共用`)
  return settings
}


// --- 改思考强度 ---
// 七档和界面滑块共用；写错的值后端会退回原值。
async function setReasoning(sessionID, reasoning) {
  const session = store.sessions[sessionID]
  if (!session) return null
  return saveSettings(sessionID, { reasoning })
}


// --- 改自动压缩阈值 ---
async function setCompactThreshold(sessionID, value) {
  const session = store.sessions[sessionID]
  if (!session) return null
  const threshold = Math.min(COMPACT_RANGE.max, Math.max(COMPACT_RANGE.min, Number(value) || DEFAULT_SETTINGS.compactThreshold))
  return saveSettings(sessionID, { compactThreshold: threshold })
}


// --- 用途的中文名 ---
const useLabel = use => (store.config.useOptions || []).find(item => item.use === use)?.label || use

// --- 把一条协议消息整理成界面消息；工具结果只更新前面对应的工具，不单独成为气泡 ---
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

// --- 归一化 Server 会话 ---
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


// --- 从配置模型目录解析供应商 ---
function findModelProvider(model) {
  const activeProvider = store.config.activeProvider
  if (store.config.providers[activeProvider]?.models?.includes(model)) return activeProvider // 同名模型优先使用当前供应商
  return Object.entries(store.config.providers).find(([, config]) => config.models?.includes(model))?.[0] || activeProvider // 再查找首个配置来源
}


// --- 创建会话摘要 ---
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


// --- 同步会话摘要 ---
function syncSummary(session) {
  const found = locate(session.id)                       // 查找工作区内摘要
  if (!found) return                                     // 异常游离会话不制造目录项
  Object.assign(found.summary, summaryOf(session))       // 将最新标题、状态、计数和时间写回列表
}

async function openByID(id) {
  const sessionID = id.trim()
  if (!/^[\w-]+$/.test(sessionID)) { UI.notify('请输入有效的会话 ID'); return false }
  try {
    const source = await AgentAPI.getSession(sessionID)
    const session = normalize(source)
    if (!locate(sessionID)) store.workspaces[0].sessions.unshift(summaryOf(session))
    store.sessions[sessionID] = session
    rememberOpened(sessionID)
    await UI.openChat(sessionID)
    return true
  } catch (error) { UI.notify(error.message); return false }
}


// --- 完成标题编辑器保存 ---
async function saveTitleEditing(currentTitle, draft, editing, emit) {
  const nextTitle = draft.value.trim()                   // 编辑器草稿转换为业务标题
  if (!nextTitle) return                                 // 空标题保持编辑状态
  if (nextTitle === currentTitle) return void (editing.value = false) // 未变化时直接退出
  emit('save', nextTitle, (saved) => { if (saved) editing.value = false }) // 页面 Command 决定是否退出
}

export const Session = {
  locate, create, open, openByID, closeOpened, refresh, rename, remove, removeMany, selectModel, fork, normalize, syncSummary, saveTitleEditing,
  saveSettings, setAgent, agentLabel, toggleCapability, toggleAutoTitle, setUse, setCompactThreshold, setReasoning,
}
