/*
界面数据仓库：保存当前业务视图、侧栏展开状态和移动布局状态。
组件通过公开动作修改这些字段，避免导航状态分散在多个页面中。
调用示例：const ui = useUIStore(); ui.openView('tools')。
*/
import { ref } from 'vue'                           // 引入 Vue 响应式基础数据
import { defineStore } from 'pinia'                 // 引入 Pinia 数据仓库定义能力

export const useUIStore = defineStore('ui', () => { // 导出唯一界面状态仓库
  const activeView = ref('home')                    // 当前主区域显示 home、chat、tools 或 settings


  // --- 打开业务视图 ---
  function openView(viewName) {
    activeView.value = viewName                     // 主区域切换到用户选择的业务页面
  }


  return { activeView, openView }                    // 暴露统一页面导航动作
})
