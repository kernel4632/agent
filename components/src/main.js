/*
组件预览入口：只挂载静态组件展示页。
这里没有 API、Store 或业务指令；页面状态只存在于组件预览本身。
调用方式：Vite 自动执行本文件并挂载到 index.html 的 #app。
*/
import { createApp } from 'vue'                         // 创建独立 Vue 应用
import 'material-symbols/outlined.css'                  // 为 M3E 图标提供本地可填充 Material Symbols 字形
import '@m3e/web/button'                                // 注册通用命令按钮
import '@m3e/web/card'                                  // 注册 Agent 活动卡片
import '@m3e/web/content-pane'                          // 注册滚动内容面板
import '@m3e/web/divider'                               // 注册内容分割线
import '@m3e/web/dialog'                                // 注册模态弹窗
import '@m3e/web/form-field'                            // 注册表单输入外框
import '@m3e/web/expansion-panel'                       // 注册可展开的 Agent 活动步骤
import '@m3e/web/heading'                               // 注册标题层级组件
import '@m3e/web/icon-button'                           // 注册图标命令按钮
import '@m3e/web/icon'                                  // 注册 Material Symbols 图标
import '@m3e/web/list'                                  // 注册交互列表
import '@m3e/web/menu'                                  // 注册弹出菜单
import '@m3e/web/search'                                // 注册搜索框
import '@m3e/web/switch'                                // 注册供应商启用开关
import '@m3e/web/theme'                                 // 注册 Material You 主题变量
import App from './App.vue'                             // 引入组件展示页
import './styles/base.scss'                             // 引入全局主题与预览页 SCSS

createApp(App).mount('#app')                             // 挂载静态组件预览
