/*
标签指令：负责恢复、创建、选择、升级、关闭和同步顶部会话标签。
标签数据只存放在 store.js；浏览器持久化由 watchers.js 响应数据变化。
调用示例：Tabs.createDraft()、Tabs.openSession('ses_123', '标题')。
*/
import { store } from '../store.js'                      // 引入全局顶部标签数据结构

const storageKey = 'agent.session-tabs'                  // 使用稳定浏览器键恢复工作区标签


// --- 恢复上次保存的标签 ---
function restore() {
  const tabStore = store.tabs                            // 读取全局标签数据
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}') // 解析上次窗口的标签顺序
    tabStore.items = Array.isArray(saved.tabs) ? saved.tabs.filter((tab) => tab.sessionID) : [] // 草稿不跨刷新恢复
    tabStore.activeKey = tabStore.items.some((tab) => tab.key === saved.activeKey) ? saved.activeKey : '' // 只恢复仍存在的选择
  } catch {
    tabStore.items = []                                  // 损坏数据回退到空标签列表
    tabStore.activeKey = ''                              // 损坏数据不保留无效选择
  }
}


// --- 创建一个草稿标签 ---
function createDraft() {
  const tabStore = store.tabs                            // 读取当前标签顺序
  const key = `draft:${crypto.randomUUID()}`             // 为独立输入上下文生成稳定身份
  tabStore.items.push({ key, sessionID: '', title: '新会话' }) // 将草稿加入顶部工作区
  tabStore.activeKey = key                               // 新草稿立即成为当前标签
  return key                                             // 返回身份供对话指令建立数据
}


// --- 打开一个已有会话标签 ---
function openSession(sessionID, title = '未命名会话', activate = true) {
  const tabStore = store.tabs                            // 读取当前标签顺序
  const key = `session:${sessionID}`                     // 将会话 ID 转换为稳定标签身份
  if (!tabStore.items.some((tab) => tab.key === key)) tabStore.items.push({ key, sessionID, title }) // 已打开时不重复添加
  if (activate) tabStore.activeKey = key                 // 前台打开时切换当前选择
  return key                                             // 返回身份供对话指令定位数据
}


// --- 将草稿升级为真实会话标签 ---
function promote(draftKey, sessionID) {
  const tabStore = store.tabs                            // 读取草稿标签和当前选择
  const tab = tabStore.items.find((item) => item.key === draftKey) // 查找收到 Server 会话 ID 的草稿
  const nextKey = `session:${sessionID}`                 // 创建可持久化的真实标签身份
  if (!tab) return nextKey                               // 标签已关闭时仍允许后台流完成

  tab.key = nextKey                                      // 原位升级以保持标签顺序
  tab.sessionID = sessionID                              // 保存后续重新读取所需的会话 ID
  if (tabStore.activeKey === draftKey) tabStore.activeKey = nextKey // 当前草稿继续保持选中
  return nextKey                                         // 返回新身份供对话映射迁移
}


// --- 选择一个已打开标签 ---
function select(key) {
  const tabStore = store.tabs                            // 读取当前标签集合
  if (!tabStore.items.some((tab) => tab.key === key)) return // 不存在的标签不能成为当前选择
  tabStore.activeKey = key                               // 将聊天页切换到目标标签
}


// --- 关闭标签并选择相邻项 ---
function close(key) {
  const tabStore = store.tabs                            // 读取当前标签顺序和选择
  const index = tabStore.items.findIndex((tab) => tab.key === key) // 定位关闭项和邻居位置
  if (index < 0) return tabStore.activeKey               // 标签不存在时保持当前选择
  const wasActive = tabStore.activeKey === key           // 记录是否需要选择邻居
  tabStore.items.splice(index, 1)                        // 从顶部工作区移除目标标签
  if (wasActive) tabStore.activeKey = tabStore.items[index]?.key ?? tabStore.items[index - 1]?.key ?? '' // 优先选择右侧邻居
  return tabStore.activeKey                              // 返回关闭后的当前标签
}


// --- 更新一个标签标题 ---
function setTitle(key, title) {
  const tabStore = store.tabs                            // 读取当前标签集合
  const tab = tabStore.items.find((item) => item.key === key) // 定位需要更新的标签
  if (!tab || !title) return                             // 无目标或空标题时保持现状
  tab.title = title                                      // 将 Server 最终标题写入顶部反馈
}


// --- 用会话摘要同步全部标题 ---
function syncTitles(sessions) {
  const tabStore = store.tabs                            // 读取所有已打开标签
  tabStore.items.forEach((tab) => {
    const session = sessions.find((item) => item.id === tab.sessionID) // 查找标签对应的最新摘要
    if (session?.title) tab.title = session.title        // 异步标题生成后更新标签反馈
  })
}


// --- 删除会话关联标签 ---
function removeSession(sessionID) {
  const tabStore = store.tabs                            // 读取所有已打开标签
  const tab = tabStore.items.find((item) => item.sessionID === sessionID) // 查找被删除会话的标签
  if (tab) close(tab.key)                                // 复用相邻选择规则移除标签
}


export const Tabs = { storageKey, restore, createDraft, openSession, promote, select, close, setTitle, syncTitles, removeSession } // 暴露全部标签指令
