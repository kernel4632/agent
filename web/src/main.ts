/*
启动：登记组件表 → （演示模式换数据源）→ 连上推送通道 → 加载扩展 → 挂 App。
组件只从组件表里取，所以登记必须在挂载前；扩展加载在登记之后，它们改的是登记好的表项。
地址带 ?demo 时用本地回放代替后端（demo.ts），接真后端时删掉那一行即可。
扩展前端把 Vue 留成外部引用，这里放到全局，打包后的脚本用 globalThis.__agentVue__ 取。
Icon 也进组件表：扩展从 @hugeicons/core-free-icons 取图标数据，再用 app.shared.Components.Icon 画，线宽和对话页一致。
*/

import * as Vue from 'vue'
import { createApp, h } from 'vue'
import App from './App.vue'
import { Agent } from './Agent'
import { API } from './api'
import { Components, Extension } from './Extension'
import { loadDevExtensions } from './dev-extensions'
import { loadDevExtensions as loadDevExtensionsProd } from './dev-extensions.prod'
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
import Icon from './components/Icon.vue'

;(globalThis as any).__agentVue__ = Vue
Extension.register({ App, History, UserMessage, AssistantMessage, CodeBlock, Thinking, ToolCall, Process, RequestStatus, ErrorMessage, CompactMessage, Composer, Stats, Icon })
const params = new URLSearchParams(location.search)
const demo = params.has('demo')
// 开发模式 ?ext=a,b：把列出的扩展前端换成源码直载（见 dev-extensions.ts）。后端仍要跑着，数据接口不换。
const dev = params.get('ext')?.split(',').map(name => name.trim()).filter(Boolean)
const shared: Record<string, unknown> = { Agent, API, History: Grouping, Components }
if (demo) await import('./demo')
Agent.push = Extension.dispatch
if (demo) Agent.connect('main')
if (dev) {
  // 开发模式：从源码加载列出的扩展（HMR + Volar）；生产构建走空实现，扩展源码不进产物。
  await (import.meta.env.PROD ? loadDevExtensionsProd : loadDevExtensions)(dev, shared)
} else await Extension.load(shared)
if (!demo && !shared.shell) Agent.connect('main')
createApp({ render: () => h(Components.App) }).mount('#app')
