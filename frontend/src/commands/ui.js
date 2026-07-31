/*
界面指令：负责切换工作台主页面和设置分类。
所有动作只修改 store.js 中的数据，不读取 Server，也不操作 DOM。
调用示例：UI.openView('chat')、UI.openSettings('mcp')。
*/
import { store } from '../store.js'                      // 引入全局界面数据结构


// --- 打开一个工作台页面 ---
function openView(viewName) {
  const uiStore = store.ui                              // 读取当前界面数据
  uiStore.activeView = viewName                          // 将主区域切换到用户选择的页面
}


// --- 打开一个设置分类 ---
function openSettings(section = 'models') {
  const uiStore = store.ui                              // 读取当前界面数据
  uiStore.settingsSection = section                      // 先选择目标分类，避免显示旧设置
  uiStore.activeView = 'settings'                        // 再打开设置主页面形成完整反馈
}


export const UI = { openView, openSettings }             // 暴露全部界面指令
