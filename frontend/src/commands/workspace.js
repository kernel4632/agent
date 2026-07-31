/*
工作区指令：组合页面、标签、会话和对话主体，完成跨主体用户动作。
本文件只编排其他指令，不直接操作 UI；用于保证 App.vue 入口只需调用一个明确动作。
调用示例：await Workspace.openSession('ses_123')、Workspace.startNewChat()。
*/
import { useChatStore, useSessionStore, useTabStore } from '../store.js' // 引入恢复工作区需要的全部数据
import { Chat } from './chat.js'                          // 引入对话加载和清理指令
import { Session } from './session.js'                    // 引入会话资源指令
import { Tabs } from './tabs.js'                          // 引入顶部标签指令
import { UI } from './ui.js'                              // 引入工作台页面指令


// --- 打开主页 ---
function openHome() {
  UI.openView('home')                                    // 保留标签并将主区域切回会话列表
}


// --- 创建新对话标签 ---
function startNewChat() {
  const key = Tabs.createDraft()                         // 先建立独立标签身份
  Chat.loadSession(null, key)                            // 再建立对应空对话数据
  UI.openView('chat')                                    // 最后反馈可输入聊天页
}


// --- 打开一个 Server 会话 ---
async function openSession(sessionID, activate = true) {
  const summary = useSessionStore().sessions.find((item) => item.id === sessionID) // 读取当前标题供标签立即展示
  const key = Tabs.openSession(sessionID, summary?.title, activate) // 新增或复用顶部标签
  if (!activate) return                                  // 后台打开只新增标签，不读取当前页面
  UI.openView('chat')                                    // 先反馈标签选择
  if (Chat.hasConversation(key)) return                  // 已加载上下文保留滚动和流状态
  const session = await Session.select(sessionID)        // 首次打开读取完整 Server 历史
  if (session) Chat.loadSession(session, key)            // 将详情写入准确标签数据
}


// --- 选择一个已打开标签 ---
async function selectTab(tab) {
  Tabs.select(tab.key)                                   // 修改顶部活动标签
  UI.openView('chat')                                    // 从主页或设置回到聊天页
  if (!tab.sessionID || Chat.hasConversation(tab.key)) return // 草稿或已加载标签无需请求
  const session = await Session.select(tab.sessionID)    // 读取尚未加载的历史
  if (session) Chat.loadSession(session, tab.key)        // 写入点击时对应标签数据
}


// --- 关闭一个顶部标签 ---
async function closeTab(tab) {
  if (!Chat.removeConversation(tab.key)) return false    // 运行中标签保留流和审批入口
  const nextKey = Tabs.close(tab.key)                    // 移除标签并选择相邻项
  if (!nextKey) return openHome()                        // 最后一个标签关闭后回主页
  const nextTab = useTabStore().tabs.find((item) => item.key === nextKey) // 查找新的活动标签
  if (nextTab) await selectTab(nextTab)                  // 未加载历史也进入准确上下文
  return true                                            // 返回关闭动作完成
}


// --- 删除一个 Server 会话 ---
async function removeSession(sessionID) {
  const removed = await Session.remove(sessionID)        // 删除 Server 内存和磁盘数据
  if (!removed) return false                             // 失败时保留标签和列表
  const tab = useTabStore().tabs.find((item) => item.sessionID === sessionID) // 查找关联标签
  if (tab) Chat.removeConversation(tab.key)              // 释放非运行对话数据
  Tabs.removeSession(sessionID)                          // 从顶部工作区移除标签
  return true                                            // 返回删除动作完成
}


// --- 重命名一个 Server 会话 ---
async function renameSession(sessionID, title) {
  const result = await Session.rename(sessionID, title)  // 将标题保存到 Server 并更新主页摘要
  if (result) Tabs.setTitle(`session:${sessionID}`, result.title) // 同步可能在前台或后台的标签
  return result                                          // 返回最终标题供入口反馈
}


// --- 重命名会话并反馈编辑器 ---
async function renameSessionWithFeedback(sessionID, title, resolve) {
  const result = await renameSession(sessionID, title)   // 执行完整 Server 和标签同步动作
  resolve(Boolean(result))                               // 通知标题编辑器退出或保留草稿
  return result                                          // 返回最终会话标题
}


// --- 重命名当前聊天会话 ---
async function renameCurrentSession(conversation, title, resolve, isRenaming, renameError) {
  if (!conversation.sessionID) return resolve(false)     // 未发送草稿没有可持久化会话
  isRenaming.value = true                                // 标题动作进入保存反馈
  renameError.value = ''                                 // 清除旧失败信息
  const result = await renameSession(conversation.sessionID, title) // 保存 Server 标题并同步顶部标签
  if (!result) renameError.value = useSessionStore().errorMessage // 在编辑器附近保存真实错误
  isRenaming.value = false                               // 恢复标题编辑动作
  resolve(Boolean(result))                               // 通知编辑器退出或保留草稿
  return result                                          // 返回完整重命名结果
}


// --- 发送消息并同步会话摘要 ---
async function sendMessage(message) {
  const completed = await Chat.send(message)             // 启动 Agent 并持续消费 SSE
  const sessions = await Session.refresh()               // 用持久化标题和计数刷新主页
  Tabs.syncTitles(sessions)                              // 将异步标题同步到全部顶部标签
  return completed                                       // 返回本轮 Agent 完成状态
}


// --- 恢复上次工作区 ---
async function restore() {
  Tabs.restore()                                         // 先恢复浏览器保存的标签身份
  const sessions = await Session.refresh()               // 再读取 Server 最新会话摘要
  Tabs.syncTitles(sessions)                              // 更新恢复标签的异步标题
  const tabStore = useTabStore()                         // 读取恢复后的当前标签
  const activeTab = tabStore.tabs.find((tab) => tab.key === tabStore.activeKey) // 查找上次活动会话
  if (activeTab) await selectTab(activeTab)              // 恢复窗口关闭前的聊天上下文
}


export const Workspace = { openHome, startNewChat, openSession, selectTab, closeTab, removeSession, renameSession, renameSessionWithFeedback, renameCurrentSession, sendMessage, restore } // 暴露全部工作区指令
