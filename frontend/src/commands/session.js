/*
Session 指令：负责创建、读取、打开、重命名、删除和切换会话模型。
Server 会话会被归一化为现有 M3E 组件可直接渲染的消息与工具结构。
调用示例：await Session.create(workspaceID)、await Session.open(sessionID)。
*/
import { AgentAPI } from '../api.js'                    // 引入正式 Session HTTP 契约
import { store } from '../store.js'                     // 引入工作区摘要与完整会话
import { UI } from './ui.js'                            // 引入导航和反馈指令
import { t } from '../i18n.js'                          // 引入当前语言默认文案


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
    const created = await AgentAPI.createSession(workspace.id, store.config.activeModel) // Server 创建并持久化完整会话
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
  if (!cleanTitle || !found || !session) return false   // 无效输入不改变两份数据
  try {
    const result = await AgentAPI.updateSession(sessionID, { title: cleanTitle }) // Server 完成验证和持久化
    found.summary.title = result.title                  // 更新侧边栏和主页摘要
    session.title = result.title                        // 更新对话页完整会话
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
  const session = store.sessions[sessionID]             // 读取当前会话
  const found = locate(sessionID)                       // 读取摘要
  const providerConfig = store.config.providers[provider] // 读取 `/config` 中的供应商模型目录
  if (!session || !found || providerConfig?.enabled === false || !providerConfig?.models?.includes(model)) return false // 只接受已配置模型
  try {
    await AgentAPI.updateSession(sessionID, { model })    // 持久化本会话模型选择
    session.provider = provider                         // 操作框即时反馈供应商
    session.model = model                               // 操作框即时反馈模型
    session.contextLimit = providerConfig.modelSettings?.[model]?.context || 128000 // 同步上下文上限
    found.summary.model = model                         // 列表摘要即时反馈选择
    return true                                         // 通知选择成功
  } catch (error) {
    UI.notify(error.message)                            // 展示 Server 配置错误
    return false                                        // 保持旧选择
  }
}


// --- 归一化 Server 会话 ---
function normalize(source, previous = {}) {
  const provider = findModelProvider(source.model)       // 从 `/config` 模型目录解析供应商
  const sessionData = structuredClone(source)              // Server 返回的 Session 即为前端公开结构
  const messages = []                                   // 将工具结果合并到所属助手消息
  for (const item of source.messages ?? []) {
    if (item.role === 'tool') {
      const assistant = [...messages].reverse().find((message) => message.role === 'assistant') // 工具结果归入最近助手轮次
      const tool = assistant?.tools?.find((entry) => entry.id === item.toolCallId) // 查找同一工具声明
      if (tool) Object.assign(tool, { status: item.status || 'completed', preview: formatToolOutput(item.result), checkpoint: item.checkpoint || item.step }) // 补齐真实结果和存档点
      continue                                           // 工具协议消息不单独占用聊天气泡
    }
    const message = structuredClone(item)                   // 复制消息避免归一化修改 Server 响应
    message.reasoning = item.reasoning || item.contentBlocks?.find((block) => block.type === 'thinking')?.thinking?.thinking || '' // 读取统一推理块
    message.content = item.content || item.contentBlocks?.filter((block) => block.type === 'text').map((block) => block.text?.text || '').join('') || '' // 合并文本块
    message.tools = (item.toolCalls ?? []).map((call) => ({ id: call.toolCallId, name: call.toolName, title: call.toolName, input: call.input, preview: '', status: 'running', checkpoint: item.checkpoint })) // 将工具声明转换为展示条
    messages.push(message)                               // 用户和助手消息进入可见时间线
  }
  return {
    ...sessionData,                                      // 保留公开 Session 身份、工作区、状态和任务
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
    rollback: source.rollback ? { ...source.rollback, preview: source.rollback.target?.content || (source.rollback.target?.step ? t('toolStep', { step: source.rollback.target.step }) : '') } : null, // 转换回退预览
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
  if (typeof output === 'string') return output          // 文本结果直接展示
  return output.result || JSON.stringify(output)         // 优先展示工具业务结果
}


// --- 创建会话摘要 ---
function summaryOf(session) {
  return { id: session.id, workspaceID: session.workspaceID, title: session.title || t('newConversation'), model: session.model, status: session.status, messageCount: session.messages.length, createdAt: session.createdAt, updatedAt: session.updatedAt, lastActiveAt: session.lastActiveAt } // 主页只保存扫描字段
}


// --- 同步会话摘要 ---
function syncSummary(session) {
  const found = locate(session.id)                       // 查找工作区内摘要
  if (!found) return                                     // 异常游离会话不制造目录项
  Object.assign(found.summary, summaryOf(session))       // 将最新标题、状态、计数和时间写回列表
}


// --- 完成标题编辑器保存 ---
async function saveTitleEditing(currentTitle, draft, editing, emit) {
  const nextTitle = draft.value.trim()                   // 编辑器草稿转换为业务标题
  if (!nextTitle) return                                 // 空标题保持编辑状态
  if (nextTitle === currentTitle) return void (editing.value = false) // 未变化时直接退出
  emit('save', nextTitle, (saved) => { if (saved) editing.value = false }) // 页面 Command 决定是否退出
}


export const Session = { locate, create, open, closeOpened, refresh, rename, remove, selectModel, normalize, syncSummary, saveTitleEditing } // 暴露会话全部业务动作
