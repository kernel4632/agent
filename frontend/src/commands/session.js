/*
会话指令：负责读取、删除、重命名和更新 Server 会话资源。
请求结果统一写入 store.js，Vue 页面只读取数据并触发这些指令。
调用示例：await Session.refresh()、await Session.rename('ses_123', '新标题')。
*/
import { AgentAPI } from '../api.js'                       // 引入会话 HTTP 指令
import { store } from '../store.js'                         // 引入全局会话数据结构


// --- 刷新会话摘要 ---
async function refresh() {
  const sessionStore = store.session                       // 读取会话列表和反馈字段
  sessionStore.isLoading = true                            // 列表进入加载反馈
  sessionStore.errorMessage = ''                           // 新请求清除旧错误
  try {
    sessionStore.items = await AgentAPI.listSessions()     // 用 Server 最新摘要替换当前列表
    return sessionStore.items                              // 返回列表供跨主体指令继续同步
  } catch (error) {
    sessionStore.errorMessage = error.message              // 保存网络或 Server 错误
    return []                                              // 失败时不制造虚假会话
  } finally {
    sessionStore.isLoading = false                         // 恢复列表交互
  }
}


// --- 读取一个会话详情 ---
async function select(sessionID) {
  const sessionStore = store.session                       // 读取详情请求反馈字段
  sessionStore.isLoading = true                            // 主区域进入加载反馈
  sessionStore.errorMessage = ''                           // 新请求清除旧错误
  try {
    return await AgentAPI.getSession(sessionID)            // 返回完整历史供对话指令写入标签
  } catch (error) {
    sessionStore.errorMessage = error.message              // 保存不存在或网络错误
    return null                                            // 失败时不覆盖当前聊天数据
  } finally {
    sessionStore.isLoading = false                         // 恢复会话选择动作
  }
}


// --- 删除一个会话 ---
async function remove(sessionID) {
  const result = await AgentAPI.removeSession(sessionID)   // 删除 Server 内存和磁盘数据
  if (!result.ok) return false                             // Server 拒绝时保持当前列表
  await refresh()                                          // 用真实 Server 状态刷新摘要
  return true                                              // 返回成功供工作区清理标签
}


// --- 重命名一个会话 ---
async function rename(sessionID, title) {
  const sessionStore = store.session                       // 读取摘要和错误字段
  sessionStore.errorMessage = ''                           // 新请求清除旧错误
  try {
    const result = await AgentAPI.renameSession(sessionID, title) // 让 Server 清理并验证标题
    const summary = sessionStore.items.find((item) => item.id === sessionID) // 定位主页中的同一摘要
    if (summary) Object.assign(summary, { title: result.title, titleSource: result.titleSource }) // 原位同步最终标题
    return result                                          // 返回最终标题供标签同步
  } catch (error) {
    sessionStore.errorMessage = error.message              // 保存失败原因供入口反馈
    return null                                            // 保持旧标题和编辑草稿
  }
}


// --- 提交会话标题草稿 ---
async function saveTitleEditing(currentTitle, draft, editing, emit) {
  const title = draft.value.trim()                      // 去除无意义首尾空白
  if (!title || title === currentTitle) {
    editing.value = false                               // 空值和未变化直接退出编辑态
    return false                                        // 返回没有产生 Server 请求
  }
  const saved = await new Promise((resolve) => emit('save', title, resolve)) // 等待上层会话指令写盘
  if (saved) editing.value = false                      // 只有写盘成功才退出编辑态
  return saved                                          // 返回最终保存结果
}


export const Session = { refresh, select, remove, rename, saveTitleEditing } // 暴露包含校验、异步请求或状态同步的会话指令
