/*
界面数据仓库：保存当前业务视图、侧栏展开状态和移动布局状态。
组件通过公开动作修改这些字段，避免导航状态分散在多个页面中。
调用示例：const ui = useUIStore(); ui.openView('tools')。
*/
import { ref } from 'vue'                           // 引入 Vue 响应式基础数据
import { defineStore } from 'pinia'                 // 引入 Pinia 数据仓库定义能力

export const useUIStore = defineStore('ui', () => { // 导出唯一界面状态仓库
  const activeView = ref('chat')                    // 当前主区域显示 chat、sessions、tools 或 settings
  const isSidebarOpen = ref(true)                   // 桌面侧栏默认展开，移动端由 App 同步调整


  // --- 打开业务视图 ---
  function openView(viewName) {
    activeView.value = viewName                     // 主区域切换到用户选择的业务页面
  }


  // --- 切换侧栏 ---
  function toggleSidebar() {
    isSidebarOpen.value = !isSidebarOpen.value      // 反转侧栏可见状态并驱动布局更新
  }


  // --- 设置侧栏状态 ---
  function setSidebar(isOpen) {
    isSidebarOpen.value = isOpen                    // 响应视口或遮罩触发设置明确状态
  }


  return { activeView, isSidebarOpen, openView, toggleSidebar, setSidebar } // 暴露界面数据与导航动作
})
