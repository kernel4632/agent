/*
Session 指令：负责创建、读取、打开、重命名、删除和切换会话模型。
Server 会话会被归一化为现有 M3E 组件可直接渲染的消息与工具结构。
调用示例：await Session.create(workspaceID)、await Session.open(sessionID)。
*/
import { AgentAPI } from '../api.js'                    // 引入正式 Session HTTP 契约
import { store } from '../store.js'                     // 引入工作区摘要与完整会话
import { UI } from './ui.js'                            // 引入导航和反馈指令
import { t } from '../i18n.js'                          // 引入当前语言默认文案


// --- 自动批准的四个类别 ---
// 界面上一个类别一个开关，可以按类别随时开关。这里的名字只用来说给用户听，
// 判断哪类工具免询问是后端的事（见 server/utils/tool-kind.js，那边是唯一来源）。
// 每一类给一个自己的图标，和工具栏上其他开关一致：亮点就是开着，暗点就是还问你。
const AUTO_APPROVE_KINDS = [
  { kind: 'read', label: '读取', icon: 'eye', hint: '读文件、列目录、搜索不用再问' },
  { kind: 'write', label: '写入', icon: 'edit', hint: '改文件、打补丁不用再问' },
  { kind: 'command', label: '命令', icon: 'code', hint: '执行命令不用再问' },
  { kind: 'mcp', label: 'MCP', icon: 'globe', hint: '外部工具服务提供的工具不用再问' },
]


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
    return true                                         // 标题编辑器退出编辑
  } catch (error) {
    UI.notify(error.message)                            // 保留编辑器内容并显示错误
    return false                                        // 不伪造保存成功
  }
}


// --- 删除会话 ---
async function remove(sessionID) {
  const found = locate(sessionID)                       // 查找工作区摘要
  if (!found) return false                              // 已删除会话无需重复动作
  try {
    await AgentAPI.removeSession(sessionID)             // Server 删除内存和磁盘会话
    found.workspace.sessions.splice(found.workspace.sessions.indexOf(found.summary), 1) // 删除目录摘要
    delete store.sessions[sessionID]                    // 删除当前已加载详情
    const openedIndex = store.ui.openedSessionIDs.indexOf(sessionID) // 查找侧边栏中的已打开会话
    if (openedIndex >= 0) store.ui.openedSessionIDs.splice(openedIndex, 1) // 删除后同步关闭对应侧边栏项
    if (store.ui.activeSessionID === sessionID) await UI.openHome() // 删除当前页后等待返回主页
    UI.notify(t('sessionDeleted'))                      // 反馈用户动作完成
    return true                                         // 通知确认弹窗关闭
  } catch (error) {
    UI.notify(error.message)                            // 运行中冲突等错误直接展示
    return false                                        // 保持本地数据与 Server 一致
  }
}


// --- 切换会话模型 ---
async function selectModel(sessionID, provider, model) {
  UI.notify('当前后端不支持切换已有会话的模型，请返回首页选择模型后新建对话')
  return false
}


// --- 改会话运行设置 ---
async function saveSettings(sessionID, change) {
  const session = store.sessions[sessionID]
  if (!session) return null
  try {
    const settings = await AgentAPI.saveSettings(sessionID, change)
    session.settings = settings                             // 后端说的是准的，本地不自己拼
    return settings
  } catch (error) {
    UI.notify(error.message)
    return null
  }
}


// --- 切换 plan / build 模式 ---
async function toggleMode(sessionID) {
  const session = store.sessions[sessionID]
  if (!session) return null
  const next = session.settings.mode === 'plan' ? 'build' : 'plan'
  const settings = await saveSettings(sessionID, { mode: next })
  // 切到计划模式时要说清会发生什么，不然用户会疑惑"工具怎么少了一半"。
  if (settings) UI.notify(next === 'plan' ? '已切到计划模式：只保留只读工具' : '已切到执行模式：可以使用全部工具')
  return settings
}


// --- 类别的中文名 ---
const labelOf = kind => AUTO_APPROVE_KINDS.find(item => item.kind === kind)?.label || kind


// --- 切换某一类的自动批准 ---
async function toggleAutoApprove(sessionID, kind) {
  const session = store.sessions[sessionID]
  if (!session) return null
  // 只提交点名的这一类，其余三类后端会保持原样。
  const next = !session.settings.autoApprove?.[kind]
  const settings = await saveSettings(sessionID, { autoApprove: { [kind]: next } })
  // 提醒一句这是降低门槛的操作：审批弹窗没了，但忽略规则仍然生效。
  if (settings) UI.notify(next ? `已开启「${labelOf(kind)}」的自动批准（密钥文件仍然拦得住）` : `已关闭「${labelOf(kind)}」的自动批准：执行前会再问你`)
  return settings
}


// --- 切换一项模型能力开关 ---
async function toggleCapability(sessionID, name) {
  const session = store.sessions[sessionID]
  if (!session) return null
  return saveSettings(sessionID, { capabilities: { [name]: !session.settings.capabilities[name] } })
}

// --- 归一化 Server 会话 ---
function normalize(source, previous = {}) {
  const provider = source.provider || findModelProvider(source.model)

  // 阶段一：将 AI SDK 协议消息转换为界面可渲染结构
  const sessionData = structuredClone(source)            // Server 返回的 Session 即为前端公开结构
  const messages = []                                    // 将 AI SDK 协议消息转换为界面气泡
  for (const item of source.history ?? []) {
    const parts = Array.isArray(item.parts) ? item.parts
      : (typeof item.content === 'string' ? [{ type: 'text', text: item.content }] : (Array.isArray(item.content) ? item.content : [])) // 兼容 parts 和旧 content 格式
    const message = structuredClone(item)                // 复制消息避免归一化修改 Server 响应
    message.id = item.messageId || item.id
    if (item.role === 'tool') {
      for (const result of parts.filter(part => part.type === 'tool-result')) {
        const tool = messages.flatMap(item => item.tools || []).find(item => item.id === result.toolCallId)
        if (tool) { tool.status = result.output?.type === 'error-text' ? 'error' : 'completed'; tool.preview = formatToolOutput(result.output) }
      }
      continue
    }
    message.reasoning = parts.filter((p) => p.type === 'reasoning').map((p) => p.reasoning || p.text || '').join('') // 合并推理块
    message.content = parts.filter((p) => p.type === 'text').map((p) => p.text || '').join('') // 合并文本块
    message.tools = parts
      .filter((p) => p.type === 'tool-invocation' || p.type === 'tool-call')
      .map((p) => {
        const call = p.toolInvocation || p                // 兼容 UIMessage parts 和旧格式
        const status = call.state === 'result' ? (call.result?.isError ? 'error' : 'completed') : 'running'
        const preview = call.state === 'result' ? formatToolOutput(call.result) : ''
        return { id: call.toolCallId, name: call.toolName, title: call.toolName, input: call.args || call.input || {}, preview, status, checkpoint: null }
      })
    messages.push(message)                               // 用户和助手消息进入可见时间线
  }
  // 阶段二：组合最终前端会话结构，补齐仅前端使用的草稿和用量字段
  return {
    ...sessionData,                                      // 保留公开 Session 身份、工作区、状态和任务
    workspaceID: source.workspaceId,
    status: previous.status || 'idle',
    connection: previous.connection || 'connecting',
    undoable: source.undoable || 0,                      // 还能撤销几次回退，由后端说，刷新页面也不会丢
    settings: source.settings || previous.settings || {  // 模式、自动批准、能力开关，后端读取时一并给出
      mode: 'build',
      // 四类全关：不替用户预先放行任何东西。
      autoApprove: { read: false, write: false, command: false, mcp: false },
      capabilities: { image: true, cache: true, stream: true },
    },
    title: sessionData.title || previous.title || '',    // 保留已有标题或使用空字符串
    titleGenerated: previous.titleGenerated || (messages.length > 2), // 有历史消息的会话不重复生成标题
    provider,                                           // 模型选择器显示供应商
    model: source.model || store.config.activeModel,    // 模型选择器显示模型
    messages,                                            // 使用合并后的可见消息
    draft: previous.draft || '',                         // 刷新历史不丢失未发送草稿
    files: previous.files || [],                         // 刷新历史不丢失附件元数据
    contextTokens: previous.contextTokens || 0,          // SSE usage 更新累计上下文
    contextLimit: store.config.providers[provider]?.modelSettings?.[source.model]?.context || previous.contextLimit || 128000, // 读取模型上下文限制
    inputTokens: previous.inputTokens || 0,              // 保留当前页面累计输入
    outputTokens: previous.outputTokens || 0,            // 保留当前页面累计输出
    cacheTokens: previous.cacheTokens || 0,              // 保留当前页面缓存用量
  }
}


// --- 从配置模型目录解析供应商 ---
function findModelProvider(model) {
  const activeProvider = store.config.activeProvider
  if (store.config.providers[activeProvider]?.models?.includes(model)) return activeProvider // 同名模型优先使用当前供应商
  return Object.entries(store.config.providers).find(([, config]) => config.models?.includes(model))?.[0] || activeProvider // 再查找首个配置来源
}


// --- 格式化工具结果预览 ---
function formatToolOutput(output) {
  if (output == null) return ''                          // 尚无结果时保持空预览
  if (output.type === 'text' || output.type === 'error-text') return output.value // AI SDK 文本结果直接展示
  if (output.type === 'execution-denied') return output.reason || t('toolDenied') // 拒绝结果展示原因
  return JSON.stringify(output.value ?? '')              // JSON 结果保持真实结构
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

export const Session = { locate, create, open, openByID, closeOpened, refresh, rename, remove, selectModel, normalize, syncSummary, saveTitleEditing, saveSettings, toggleMode, toggleAutoApprove, toggleCapability }
// 界面按这份名单画自动批准的开关，所以它跟着 Session 一起给出去。
export { AUTO_APPROVE_KINDS }
