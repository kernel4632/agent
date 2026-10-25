/*
入口：挂载 Vue 应用，只在这里引入全局样式、启动数据监听并加载工作区与配置。
调用示例：由 index.html 的 <script type="module" src="/src/main.js"> 自动执行。
*/
import { createApp } from 'vue'
import '@m3e/web/theme'
import '@kernel4632/kima/style.css'   // KIMA 完整样式包；0.7.1 的 select 作用域修正在 patches/ 里
import './styles/base.scss'          // 应用自己的排版和布局覆盖，必须排在 KIMA 之后
import './styles/tokens.scss'        // 把 KIMA 色板映射成 --la-* 业务 token
import App from './App.vue'
import { startWatchers } from './watchers.js'
import { Config } from './commands/config.js'
import { Workspace } from './commands/workspace.js'
import { store } from './store.js'

startWatchers()
createApp(App).mount('#app')
Promise.all([Workspace.load(), Config.load()]).finally(() => { store.ui.isLoading = false })
