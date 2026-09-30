import { createApp } from 'vue'
import '@m3e/web/theme'
import './styles/base.scss'
import './styles/tokens.scss'
import App from './App.vue'
import { startWatchers } from './watchers.js'
import { Config } from './commands/config.js'
import { Workspace } from './commands/workspace.js'
import { store } from './store.js'

startWatchers()
createApp(App).mount('#app')
Promise.all([Workspace.load(), Config.load()]).finally(() => { store.ui.isLoading = false })
