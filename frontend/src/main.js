/*
前端入口：加载 Vue、Pinia、MDUI 2 和全局 SCSS，然后挂载根组件。
入口不处理业务逻辑，所有用户动作由 views 调用 stores 中的指令完成。
调用方式：Vite 从 index.html 自动执行本文件。
*/
import { createApp } from 'vue'                    // 引入 Vue 应用创建能力
import { createPinia } from 'pinia'                // 引入全局业务数据仓库
import 'mdui/mdui.css'                             // 引入 MDUI 2 Material You 基础样式
import 'mdui'                                      // 注册全部 MDUI 2 Web Components
import '@mdui/icons/menu.js'                       // 注册侧栏菜单图标
import '@mdui/icons/add.js'                        // 注册新建会话图标
import '@mdui/icons/send.js'                       // 注册发送消息图标
import '@mdui/icons/stop.js'                       // 注册停止任务图标
import '@mdui/icons/settings.js'                   // 注册设置视图图标
import '@mdui/icons/build.js'                      // 注册工具视图图标
import '@mdui/icons/delete.js'                     // 注册删除会话图标
import '@mdui/icons/refresh.js'                    // 注册重载工具图标
import '@mdui/icons/history.js'                    // 注册会话历史图标
import '@mdui/icons/more-vert.js'                  // 注册更多操作图标
import '@mdui/icons/expand-more.js'                // 注册模型下拉图标
import '@mdui/icons/check.js'                      // 注册当前模型状态图标
import '@mdui/icons/edit.js'                       // 注册提供商编辑图标
import '@mdui/icons/key.js'                        // 注册密钥配置图标
import '@mdui/icons/dns.js'                        // 注册模型服务图标
import '@mdui/icons/close.js'                      // 注册移除模型图标
import './styles/main.scss'                        // 引入 Agent 黑白视觉主题
import App from './App.vue'                        // 引入根界面组合组件

const app = createApp(App)                         // 创建唯一 Vue 应用实例
app.use(createPinia())                             // 让所有视图共享 Pinia 数据仓库
app.mount('#app')                                  // 将完整 Agent 工作台挂载到页面
