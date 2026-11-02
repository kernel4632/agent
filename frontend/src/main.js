/*
入口：挂载 Vue 应用，只在这里引入全局样式、启动数据监听并加载工作区与配置。
调用示例：由 index.html 的 <script type="module" src="/src/main.js"> 自动执行。
*/
import { Settings } from './commands/settings.js'
import { Session } from './commands/session.js'

import { createApp } from 'vue'
import './styles/tokens.scss'        // 项目自己的颜色、尺寸和动效变量
import './styles/base.scss'          // 全局重置与可访问性规则
import App from './App.vue'
import { startWatchers } from './watchers.js'
import { store } from './store.js'

startWatchers()
createApp(App).mount('#app')
Promise.all([Session.list(), Settings.load()]).finally(() => { store.ui.isLoading = false })
