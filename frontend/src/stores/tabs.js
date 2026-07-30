/*
会话标签仓库：保存顶部已打开会话、当前标签和关闭后的邻居选择。
标签只描述导航身份，消息与流状态由 chat store 按标签分别保存。
调用示例：tabs.openSession('ses_xxx')、tabs.close('session:ses_xxx')。
*/
import { ref, watch } from 'vue'                      // 引入响应式标签和本地持久化监听
import { defineStore } from 'pinia'                  // 引入 Pinia 数据仓库定义能力

const storageKey = 'agent.session-tabs'              // 使用稳定浏览器键恢复工作区标签


// --- 读取本地标签状态 ---
function readSavedTabs() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}') // 解析上次窗口的标签顺序
    return { tabs: Array.isArray(saved.tabs) ? saved.tabs.filter((tab) => tab.sessionID) : [], activeKey: saved.activeKey ?? '' } // 草稿不跨刷新恢复
  } catch {
    return { tabs: [], activeKey: '' }                // 损坏数据回退到空主页
  }
}


export const useTabStore = defineStore('tabs', () => { // 导出唯一顶部标签仓库
  const saved = readSavedTabs()                       // 读取启动时可恢复的会话标签
  const tabs = ref(saved.tabs)                        // 按用户打开顺序保存标签
  const activeKey = ref(saved.activeKey)              // 当前聊天视图对应的标签键


  // --- 持久化标签工作区 ---
  watch([tabs, activeKey], () => {
    const persistentTabs = tabs.value.filter((tab) => tab.sessionID) // 未发送草稿不写入下次窗口
    const persistentKey = persistentTabs.some((tab) => tab.key === activeKey.value) ? activeKey.value : '' // 只保存仍存在的活动标签
    localStorage.setItem(storageKey, JSON.stringify({ tabs: persistentTabs, activeKey: persistentKey })) // 同步顺序和选择
  }, { deep: true })


  // --- 新建草稿标签 ---
  function createDraft() {
    const key = `draft:${crypto.randomUUID()}`        // 每个空白输入器拥有独立运行上下文
    tabs.value.push({ key, sessionID: '', title: '新会话' }) // 将草稿加入顶部工作区
    activeKey.value = key                             // 新草稿立即成为当前标签
    return key                                        // 反馈 chat store 创建对应上下文
  }


  // --- 打开已有会话标签 ---
  function openSession(sessionID, title = '未命名会话', activate = true) {
    const key = `session:${sessionID}`                // 会话 ID 映射为稳定标签键
    if (!tabs.value.some((tab) => tab.key === key)) tabs.value.push({ key, sessionID, title }) // 已打开时不重复添加
    if (activate) activeKey.value = key               // 普通点击切换，后台打开只新增标签
    return key                                        // 反馈消息上下文使用的键
  }


  // --- 将草稿升级为真实会话 ---
  function promote(draftKey, sessionID) {
    const tab = tabs.value.find((item) => item.key === draftKey) // 查找收到 session-created 的草稿
    const nextKey = `session:${sessionID}`             // 创建持久化会话标签键
    if (!tab) return nextKey                            // 标签已关闭时仍允许流上下文完成升级
    tab.key = nextKey                                   // 原位保持标签顺序
    tab.sessionID = sessionID                           // 后续切换可重新读取 Server 历史
    if (activeKey.value === draftKey) activeKey.value = nextKey // 当前草稿保持选中
    return nextKey                                      // 反馈 chat store 迁移上下文
  }


  // --- 选择一个已打开标签 ---
  function select(key) {
    if (tabs.value.some((tab) => tab.key === key)) activeKey.value = key // 只允许选择真实存在的标签
  }


  // --- 关闭标签并选择相邻项 ---
  function close(key) {
    const index = tabs.value.findIndex((tab) => tab.key === key) // 定位关闭项和相邻顺序
    if (index < 0) return activeKey.value               // 标签不存在时保持当前选择
    const wasActive = activeKey.value === key           // 背景关闭不改变当前页面
    tabs.value.splice(index, 1)                          // 从顶部标签条移除目标
    if (wasActive) activeKey.value = tabs.value[index]?.key ?? tabs.value[index - 1]?.key ?? '' // 优先右侧，其次左侧，最后主页
    return activeKey.value                               // 反馈 App 应打开的下一个上下文
  }


  // --- 更新会话标题 ---
  function setTitle(key, title) {
    const tab = tabs.value.find((item) => item.key === key) // 定位对应顶部标签
    if (tab && title) tab.title = title                     // 空标题不覆盖现有反馈
  }


  // --- 用会话摘要同步标题 ---
  function syncTitles(sessions) {
    tabs.value.forEach((tab) => {
      const session = sessions.find((item) => item.id === tab.sessionID) // 查找最新 Server 摘要
      if (session?.title) tab.title = session.title                       // 异步标题生成后更新标签
    })
  }


  // --- 删除会话关联标签 ---
  function removeSession(sessionID) {
    const tab = tabs.value.find((item) => item.sessionID === sessionID) // 查找被删除会话的标签
    if (tab) close(tab.key)                                             // 复用相邻选择规则关闭
  }


  return { tabs, activeKey, createDraft, openSession, promote, select, close, setTitle, syncTitles, removeSession } // 暴露标签数据与动作
})
