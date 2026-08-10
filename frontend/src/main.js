/*
前端入口：加载 Vue、M3E 组件和全局 SCSS，然后挂载根组件。
入口不处理业务逻辑，所有用户动作由 views 调用 stores 中的指令完成。
调用方式：Vite 从 index.html 自动执行本文件。
*/
import { createApp } from 'vue'                    // 引入 Vue 应用创建能力
import { startWatchers } from './watchers.js'      // 引入集中管理的数据变化副作用
import { Config } from './commands/config.js'      // 引入应用配置和能力加载指令
import { Workspace } from './commands/workspace.js' // 引入主页工作区加载指令
import { store } from './store.js'                 // 引入启动状态反馈数据
import '@m3e/web/avatar'                            // 注册 M3E 组件：身份头像
import '@m3e/web/button'                            // 注册 M3E 组件：文本命令
import '@m3e/web/card'                              // 注册 M3E 组件：内容容器
import '@m3e/web/checkbox'                          // 注册 M3E 组件：任务状态控件
import '@m3e/web/chips'                             // 注册 M3E 组件：附件 Chip
import '@m3e/web/dialog'                            // 注册 M3E 组件：确认弹窗
import '@m3e/web/expansion-panel'                   // 注册 M3E 组件：折叠面板
import '@m3e/web/form-field'                        // 注册 M3E 组件：输入字段外观
import '@m3e/web/heading'                           // 注册 M3E 组件：标题层级
import '@m3e/web/icon'                              // 注册 M3E 组件：SVG 图标（图标注册依赖此模块）
import '@m3e/web/icon-button'                       // 注册 M3E 组件：图标命令
import '@m3e/web/list'                              // 注册 M3E 组件：列表
import '@m3e/web/menu'                              // 注册 M3E 组件：浮层菜单
import '@m3e/web/progress-indicator'                // 注册 M3E 组件：请求进度
import '@m3e/web/search'                            // 注册 M3E 组件：搜索框
import '@m3e/web/select'                            // 注册 M3E 组件：选择器
import '@m3e/web/snackbar'                          // 注册 M3E 组件：即时反馈
import '@m3e/web/switch'                            // 注册 M3E 组件：开关
import '@m3e/web/textarea-autosize'                 // 注册 M3E 组件：自适应文本
import '@m3e/web/theme'                             // 注册 M3E 组件：暗色主题
import '@m3e/web/tooltip'                           // 注册 M3E 组件：导航提示
import '@m3e/icons/outlined'                        // 注册全部 Outlined 图标（依赖上方 @m3e/web/icon 的 registerIcon）
import './styles/base.scss'                        // 引入全局主题和布局 token
import App from './App.vue'                        // 引入根界面组合组件

const app = createApp(App)                         // 创建唯一 Vue 应用实例
startWatchers()                                    // 启动标签持久化等集中副作用
await Promise.all([Workspace.load(), Config.load()]) // 页面挂载前并行恢复 Server 事实
store.ui.isLoading = false                         // 首次资源加载完成后开放工作台
app.mount('#app')                                  // 将完整 Agent 工作台挂载到页面
