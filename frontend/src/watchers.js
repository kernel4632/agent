/*
数据监听：集中响应标签数据变化并保存浏览器工作区状态。
监听只负责持久化副作用，不处理标签业务；标签修改统一来自 commands/tabs.js。
调用示例：在 Vue 应用挂载前执行 startWatchers()。
*/
import { watch } from 'vue'                             // 引入响应式数据监听能力
import { store } from './store.js'                      // 引入需要持久化的标签数据
import { Tabs } from './commands/tabs.js'               // 引入稳定浏览器存储键
import { Settings } from './commands/settings.js'       // 引入提供商反馈同步指令


// --- 启动全部数据监听 ---
export function startWatchers() {
  const tabStore = store.tabs                           // 读取全局顶部标签和当前选择
  watch(() => [tabStore.items, tabStore.activeKey], () => {
    const persistentTabs = tabStore.items.filter((tab) => tab.sessionID) // 未发送草稿不写入下次窗口
    const persistentKey = persistentTabs.some((tab) => tab.key === tabStore.activeKey) ? tabStore.activeKey : '' // 只保存仍存在的活动标签
    localStorage.setItem(Tabs.storageKey, JSON.stringify({ tabs: persistentTabs, activeKey: persistentKey })) // 同步标签顺序和选择
  }, { deep: true })                                    // 标题、顺序和选择变化都需要持久化
}


// --- 监听能力设置分类 ---
export function watchCapabilitySection(readSection, selectSection) {
  return watch(readSection, (section) => {
    if (section) selectSection(section)                 // 一级设置变化后同步能力页面分类
  })
}


// --- 监听提供商编辑上下文 ---
export function watchProviderEditor(providerNames, selectedProvider, currentProvider, headersText, headersError, testState, emit) {
  watch(providerNames, (names) => {
    Settings.syncSelectedProvider(names, selectedProvider) // 提供商集合变化后保持有效选择
  }, { immediate: true })
  watch(selectedProvider, () => {
    Settings.syncProviderFeedback(currentProvider.value, headersText, headersError, testState) // 选择变化后同步请求头和测试反馈
  }, { immediate: true })
  watch(headersError, (error) => emit('validity', !error), { immediate: true }) // 校验错误变化后通知设置页是否允许保存
}


// --- 监听消息时间线变化 ---
export function watchMessages(readMessages, scrollToLatest) {
  return watch(readMessages, scrollToLatest, { deep: true }) // 文本、工具和审批变化后保持最新反馈可见
}


// --- 监听 Markdown 内容变化 ---
export function watchMarkdownContent(readContent, enhanceContent) {
  return watch(readContent, enhanceContent, { flush: 'post' }) // DOM 写入后执行链接、代码和图表增强
}
