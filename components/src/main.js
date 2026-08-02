/*
组件预览入口：只挂载静态组件展示页。
这里没有 API、Store 或业务指令；页面状态只存在于组件预览本身。
调用方式：Vite 自动执行本文件并挂载到 index.html 的 #app。
*/
import { createApp } from 'vue'                         // 创建独立 Vue 应用
import 'material-symbols/outlined.css'                  // 为 M3E 图标提供本地可填充 Material Symbols 字形
import '@m3e/web/button'                                // 注册模型选择按钮
import '@m3e/web/content-pane'                          // 注册主页左右内容面板
import '@m3e/web/divider'                               // 注册侧边栏内容分割线
import '@m3e/web/dialog'                                // 注册会话重命名弹窗
import '@m3e/web/form-field'                            // 注册会话名称输入框
import '@m3e/web/heading'                               // 注册主页层级标题
import '@m3e/web/icon-button'                           // 注册附件和提交图标按钮
import '@m3e/web/icon'                                  // 注册 M3E Material Symbols 图标
import '@m3e/web/list'                                  // 注册工作区和会话操作列表
import '@m3e/web/menu'                                  // 注册模型选择菜单和展开动画
import '@m3e/web/search'                                // 注册主页搜索框
import '@m3e/web/theme'                                 // 注册 Material You 主题变量
import App from './App.vue'                             // 引入组件展示页
import './styles/base.scss'                             // 引入全局主题与预览页 SCSS

createApp(App).mount('#app')                             // 挂载静态组件预览
