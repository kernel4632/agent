/*
启动：登记组件表 → （演示模式换数据源）→ 连上推送通道 → 加载扩展 → 挂 App。
组件只从组件表里取，所以登记必须在挂载前；扩展加载在登记之后，它们改的是登记好的表项。
地址带 ?demo 时用本地回放代替后端（demo.ts），接真后端时删掉那一行即可。
*/

import { createApp } from 'vue'
import App from './App.vue'
import { Agent } from './Agent'
import { API } from './api'
import { Components, Extension } from './Extension'
import History, { History as Grouping } from './components/History.vue'
import UserMessage from './components/UserMessage.vue'
import AssistantMessage from './components/AssistantMessage.vue'
import CodeBlock from './components/CodeBlock.vue'
import Thinking from './components/Thinking.vue'
import ToolCall from './components/ToolCall.vue'
import Process from './components/Process.vue'
import RequestStatus from './components/RequestStatus.vue'
import ErrorMessage from './components/ErrorMessage.vue'
import CompactMessage from './components/CompactMessage.vue'
import Composer from './components/Composer.vue'
import Stats from './components/Stats.vue'

Extension.register({ History, UserMessage, AssistantMessage, CodeBlock, Thinking, ToolCall, Process, RequestStatus, ErrorMessage, CompactMessage, Composer, Stats })
if (new URLSearchParams(location.search).has('demo')) await import('./demo')
Agent.push = Extension.dispatch
Agent.connect('main')
await Extension.load({ Agent, API, History: Grouping, Components })
createApp(App).mount('#app')
