/*
前端入口：加载 Vue、M3E 组件和全局 SCSS，然后挂载根组件。
入口不处理业务逻辑，所有用户动作由 views 调用 stores 中的指令完成。
调用方式：Vite 从 index.html 自动执行本文件。
*/
import { createApp } from 'vue'                    // 引入 Vue 应用创建能力
import { startWatchers } from './watchers.js'      // 引入集中管理的数据变化副作用
import '@m3e/web/avatar'                            // 注册身份头像
import '@m3e/web/button'                            // 注册文本命令
import '@m3e/web/card'                              // 注册内容容器
import '@m3e/web/checkbox'                          // 注册任务状态控件
import '@m3e/web/chips'                             // 注册附件 Chip
import '@m3e/web/dialog'                            // 注册确认和模型弹窗
import '@m3e/web/expansion-panel'                   // 注册任务折叠面板
import '@m3e/web/form-field'                        // 注册原生输入字段外观
import '@m3e/web/icon'                              // 与图标包共享 SVG Registry
import '@m3e/web/icon-button'                       // 注册图标命令
import '@m3e/web/progress-indicator'                // 注册请求进度反馈
import '@m3e/web/search'                            // 注册主页搜索框
import '@m3e/web/select'                            // 注册模型和权限选择器
import '@m3e/web/snackbar'                          // 注册全局即时反馈
import '@m3e/web/switch'                            // 注册设置开关
import '@m3e/web/textarea-autosize'                 // 注册自适应长文本能力
import '@m3e/web/theme'                             // 注册 Material 3 暗色主题
import 'katex/dist/katex.min.css'                  // 引入数学公式排版基础样式
import '@m3e/icons/outlined/add'                    // 注册新建动作图标
import '@m3e/icons/outlined/arrow_upward'           // 注册发送动作图标
import '@m3e/icons/outlined/attach_file'            // 注册附件图标
import '@m3e/icons/outlined/award_star'             // 注册推理状态图标
import '@m3e/icons/outlined/build'                  // 注册工具图标
import '@m3e/icons/outlined/check_circle'           // 注册完成状态图标
import '@m3e/icons/outlined/close'                  // 注册关闭动作图标
import '@m3e/icons/outlined/code'                   // 注册命令工具图标
import '@m3e/icons/outlined/content_copy'           // 注册复制动作图标
import '@m3e/icons/outlined/delete'                 // 注册删除动作图标
import '@m3e/icons/outlined/dns'                    // 注册供应商图标
import '@m3e/icons/outlined/download'               // 注册下载动作图标
import '@m3e/icons/outlined/edit'                   // 注册重命名动作图标
import '@m3e/icons/outlined/error'                  // 注册错误状态图标
import '@m3e/icons/outlined/keyboard_arrow_down'    // 注册展开状态图标
import '@m3e/icons/outlined/folder'                 // 注册工作区图标
import '@m3e/icons/outlined/history'                // 注册历史会话图标
import '@m3e/icons/outlined/home'                   // 注册主页图标
import '@m3e/icons/outlined/hub'                    // 注册 MCP 图标
import '@m3e/icons/outlined/keyboard_double_arrow_left' // 注册收起侧边栏图标
import '@m3e/icons/outlined/keyboard_arrow_right'   // 注册列表导航图标
import '@m3e/icons/outlined/menu_open'              // 注册展开侧边栏图标
import '@m3e/icons/outlined/palette'                // 注册外观图标
import '@m3e/icons/outlined/pause_circle'           // 注册暂停状态图标
import '@m3e/icons/outlined/search'                 // 注册搜索图标
import '@m3e/icons/outlined/settings'               // 注册设置图标
import '@m3e/icons/outlined/smart_toy'              // 注册提示词图标
import '@m3e/icons/outlined/stop'                   // 注册停止动作图标
import '@m3e/icons/outlined/storage'                // 注册数据管理图标
import '@m3e/icons/outlined/tune'                   // 注册模型设置图标
import '@m3e/icons/outlined/undo'                   // 注册回退动作图标
import '@m3e/icons/outlined/upload'                 // 注册上传动作图标
import App from './App.vue'                        // 引入根界面组合组件

const app = createApp(App)                         // 创建唯一 Vue 应用实例
startWatchers()                                    // 再启动标签持久化等集中副作用
app.mount('#app')                                  // 将完整 Agent 工作台挂载到页面
