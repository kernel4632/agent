/*
组件预览入口：只挂载静态组件展示页。
这里没有 API、Store 或业务指令；页面状态只存在于组件预览本身。
调用方式：Vite 自动执行本文件并挂载到 index.html 的 #app。
*/
import { createApp } from 'vue'                         // 创建独立 Vue 应用
import '@m3e/web/button'                                // 注册模型选择按钮
import '@m3e/web/icon-button'                           // 注册附件和提交图标按钮
import '@m3e/web/menu'                                  // 注册模型选择菜单和展开动画
import '@m3e/web/theme'                                 // 注册 Material You 主题变量
import App from './App.vue'                             // 引入组件展示页
import './styles/base.css'                              // 引入预览页基础样式

createApp(App).mount('#app')                             // 挂载静态组件预览
