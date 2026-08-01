/*
Session 指令：负责创建、打开、重命名、删除和切换当前模型。
Workspace 只保存摘要，完整 Session 保存在 store.sessions 中。
调用示例：Session.create(workspaceID)、Session.rename(sessionID, title)。
*/
import { store } from '../store.js'                                  // 引入工作区摘要与完整 Session
import { UI } from './ui.js'                                         // 引入导航和反馈指令
import { t } from '../i18n.js'                                       // 引入当前语言默认文案


// --- 查找 Session 摘要和所属工作区 ---
function locate(sessionID) {
  for (const workspace of store.workspaces) {
    const summary = workspace.sessions.find((session) => session.id === sessionID) // 在当前工作区摘要中查找
    if (summary) return { workspace, summary }                         // 返回后续修改需要的同一引用
  }
  return null                                                         // 未找到时由调用动作决定反馈
}


// --- 创建 Session ---
function create(workspaceID = store.ui.activeWorkspaceID) {
  const workspace = store.workspaces.find((item) => item.id === workspaceID) || store.workspaces[0] // 没有选择时使用首个工作区
  if (!workspace) return null                                         // 没有任何工作区时不能创建归属不明的会话

  const provider = Object.entries(store.config.providers).find(([, value]) => value.enabled)?.[0] || '' // 使用首个启用服务
  const model = store.config.providers[provider]?.models?.[0] || ''   // 使用该服务首个模型
  const id = `session-${crypto.randomUUID().slice(0, 8)}`             // 创建稳定 Session 身份
  const currentTime = Date.now()                                      // 摘要和详情共享创建时间
  const session = {
    id, title: t('newConversation'), provider, model, modelOptions: {}, prompt: store.config.prompt, permissions: {}, messages: [], tasks: [], files: [], rollback: null,
    contextTokens: 0, contextLimit: store.config.providers[provider]?.modelSettings?.[model]?.context || 128000,
    inputTokens: 0, outputTokens: 0, cacheTokens: 0, status: 'idle', draft: '', createdAt: currentTime, updatedAt: currentTime,
  }

  // TODO(API): POST /session，提交 title 与 workspaceId，并用响应覆盖本地 Session。
  store.sessions[id] = session                                        // 完整会话进入当前内存数据
  workspace.sessions.unshift({ id, title: session.title, model, messageCount: 0, createdAt: currentTime, updatedAt: currentTime }) // 摘要进入工作区首位
  UI.openChat(id)                                                      // 新建按钮立即进入可输入对话页
  return session                                                       // 返回新会话供组合动作使用
}


// --- 打开 Session ---
function open(sessionID) {
  const found = locate(sessionID)                                      // 确认目录中存在目标 Session
  if (!found) return false                                             // 无效点击保持当前页面

  // TODO(API): GET /session?sessionId=...；本地没有详情时读取完整 Session 并写入 store.sessions。
  store.ui.activeWorkspaceID = found.workspace.id                      // 侧边栏与主页保持正确工作区归属
  UI.openChat(sessionID)                                               // 打开对应对话页
  return true                                                          // 反馈页面已经切换
}


// --- 重命名 Session ---
function rename(sessionID, title) {
  const cleanTitle = title.trim()                                      // 标题不保留首尾空白
  const found = locate(sessionID)                                      // 查找摘要归属
  const session = store.sessions[sessionID]                            // 查找完整会话
  if (!cleanTitle || !found || !session) return false                  // 无效输入不改变两份数据

  // TODO(API): PATCH /session，提交 sessionId 与 title。
  found.summary.title = cleanTitle                                     // 更新侧边栏和主页摘要
  found.summary.updatedAt = Date.now()                                 // 重命名计入最近活动
  session.title = cleanTitle                                           // 更新对话页完整会话
  session.updatedAt = found.summary.updatedAt                          // 两份更新时间保持一致
  return true                                                          // 标题编辑器据此退出编辑
}


// --- 删除 Session ---
function remove(sessionID) {
  const found = locate(sessionID)                                      // 查找工作区摘要
  if (!found) return false                                             // 已删除会话无需重复动作

  // TODO(API): DELETE /session，请求体携带 sessionId。
  found.workspace.sessions.splice(found.workspace.sessions.indexOf(found.summary), 1) // 删除目录摘要
  delete store.sessions[sessionID]                                     // 删除当前已加载详情
  if (store.ui.activeSessionID === sessionID) UI.openHome()            // 删除当前页后回主页
  UI.notify(t('sessionDeleted'))                                       // 反馈用户动作完成
  return true                                                          // 通知确认弹窗关闭
}


// --- 切换 Session 模型 ---
function selectModel(sessionID, provider, model) {
  const session = store.sessions[sessionID]                            // 读取当前会话
  const found = locate(sessionID)                                      // 读取摘要
  if (!session || !found || !store.config.providers[provider]?.models.includes(model)) return false // 只接受已配置模型

  // TODO(API): PATCH /session，提交 sessionId、provider 和 model。
  session.provider = provider                                          // Session 独立保存供应商
  session.model = model                                                // Session 独立保存模型
  session.contextLimit = store.config.providers[provider].modelSettings?.[model]?.context || 128000 // 同步上下文上限
  found.summary.model = model                                          // 列表摘要即时反馈选择
  return true                                                          // 通知模型菜单选择成功
}


// --- 完成标题编辑器保存 ---
async function saveTitleEditing(currentTitle, draft, editing, emit) {
  const nextTitle = draft.value.trim()                                 // 编辑器草稿转换为业务标题
  if (!nextTitle) return                                                // 空标题保持编辑状态
  if (nextTitle === currentTitle) return void (editing.value = false)  // 未变化时直接退出
  emit('save', nextTitle, (saved) => { if (saved) editing.value = false }) // 将最终结果交给页面 Command
}


export const Session = { locate, create, open, rename, remove, selectModel, saveTitleEditing } // 暴露 Session 业务动作
