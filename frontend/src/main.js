/*
前端入口：加载 Vue、MDUI 2 和全局 SCSS，然后挂载根组件。
入口不处理业务逻辑，所有用户动作由 views 调用 stores 中的指令完成。
调用方式：Vite 从 index.html 自动执行本文件。
*/
import { createApp } from 'vue'                    // 引入 Vue 应用创建能力
import { startWatchers } from './watchers.js'      // 引入集中管理的数据变化副作用
import 'mdui/mdui.css'                             // 引入 MDUI 2 Material You 基础样式
import 'mdui'                                      // 注册全部 MDUI 2 Web Components
import { setTheme } from 'mdui/functions/setTheme.js' // 使用 MDUI 官方主题状态
import 'katex/dist/katex.min.css'                  // 引入数学公式排版基础样式
import '@mdui/icons/menu.js'                       // 注册侧栏菜单图标
import '@mdui/icons/menu-open.js'                  // 注册侧栏展开图标
import '@mdui/icons/keyboard-double-arrow-left.js' // 注册侧栏收起图标
import '@mdui/icons/add.js'                        // 注册新建会话图标
import '@mdui/icons/send.js'                       // 注册发送消息图标
import '@mdui/icons/arrow-upward.js'               // 注册输入器发送图标
import '@mdui/icons/stop.js'                       // 注册停止任务图标
import '@mdui/icons/settings.js'                   // 注册设置视图图标
import '@mdui/icons/build.js'                      // 注册工具视图图标
import '@mdui/icons/delete.js'                     // 注册删除会话图标
import '@mdui/icons/refresh.js'                    // 注册重载工具图标
import '@mdui/icons/history.js'                    // 注册会话历史图标
import '@mdui/icons/more-vert.js'                  // 注册更多操作图标
import '@mdui/icons/expand-more.js'                // 注册模型下拉图标
import '@mdui/icons/chevron-right.js'              // 注册运行能力设置入口图标
import '@mdui/icons/check.js'                      // 注册当前模型状态图标
import '@mdui/icons/edit.js'                       // 注册提供商编辑图标
import '@mdui/icons/key.js'                        // 注册密钥配置图标
import '@mdui/icons/dns.js'                        // 注册模型服务图标
import '@mdui/icons/hub.js'                        // 注册 MCP 设置图标
import '@mdui/icons/code.js'                       // 注册 LSP 设置图标
import '@mdui/icons/extension.js'                  // 注册 Agent Skills 设置图标
import '@mdui/icons/close.js'                      // 注册移除模型图标
import '@mdui/icons/home.js'                       // 注册顶部主页图标
import '@mdui/icons/undo.js'                       // 注册撤销回退图标
import '@mdui/icons/search.js'                     // 注册主页搜索图标
import '@mdui/icons/folder.js'                     // 注册工作区图标
import '@mdui/icons/folder-open.js'                // 注册已选工作区图标
import '@mdui/icons/keyboard-arrow-left.js'        // 注册返回方向图标
import '@mdui/icons/keyboard-arrow-right.js'       // 注册列表方向图标
import '@mdui/icons/keyboard-arrow-up.js'          // 注册消息向上跳转图标
import '@mdui/icons/keyboard-arrow-down.js'        // 注册消息向下跳转图标
import '@mdui/icons/attach-file.js'                // 注册消息附件图标
import '@mdui/icons/content-copy.js'               // 注册消息复制图标
import '@mdui/icons/error-outline.js'              // 注册消息错误图标
import '@mdui/icons/download.js'                   // 注册模型发现和导出图标
import '@mdui/icons/upload.js'                     // 注册数据导入图标
import '@mdui/icons/tune.js'                       // 注册模型设置图标
import '@mdui/icons/smart-toy.js'                  // 注册系统提示词图标
import '@mdui/icons/palette.js'                    // 注册外观设置图标
import '@mdui/icons/storage.js'                    // 注册数据管理图标
import App from './App.vue'                        // 引入根界面组合组件

setTheme('dark')                                   // 固定黑白 Material You 暗色基线
const app = createApp(App)                         // 创建唯一 Vue 应用实例
startWatchers()                                    // 再启动标签持久化等集中副作用
app.mount('#app')                                  // 将完整 Agent 工作台挂载到页面
