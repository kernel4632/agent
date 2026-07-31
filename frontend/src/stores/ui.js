/*
界面数据：定义工作台当前页面和设置分类。
本文件只暴露响应式字段，页面切换统一由 commands/ui.js 修改。
调用示例：const uiStore = useUIStore()。
*/
import { ref } from 'vue'                           // 引入界面字段需要的响应式容器
import { defineStore } from 'pinia'                 // 引入界面数据仓库定义能力

export const useUIStore = defineStore('ui', () => { // 暴露唯一界面数据结构
  const activeView = ref('home')                    // 当前主区域：home、chat 或 settings
  const settingsSection = ref('models')             // 当前设置分类：模型、Agent、权限或外部能力

  return { activeView, settingsSection }             // 只暴露界面数据，不附带修改动作
})
