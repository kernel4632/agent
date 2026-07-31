/*
会话标签数据：定义顶部标签顺序和当前标签身份。
本文件不读取浏览器存储，也不修改标签；相关动作分别位于 commands/tabs.js 和 watchers.js。
调用示例：const tabStore = useTabStore()。
*/
import { ref } from 'vue'                             // 引入标签字段需要的响应式容器
import { defineStore } from 'pinia'                   // 引入标签数据仓库定义能力

export const useTabStore = defineStore('tabs', () => { // 暴露唯一标签数据结构
  const tabs = ref([])                                // 已打开标签，元素包含 key、sessionID 和 title
  const activeKey = ref('')                           // 当前聊天页对应的标签 key

  return { tabs, activeKey }                          // 只暴露标签数据，不附带修改动作
})
