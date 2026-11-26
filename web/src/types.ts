/*
扩展前端协议的类型：App（每个扩展 frontend/index.js 收到的对象）、ShellApi（壳）、Shared（宿主共享表）。
本体代码直接 import type；扩展代码是 JS，在 JSDoc 里引用，名字 'agent-extension'
由 extensions/tsconfig.json 的 paths 映射到这里（vite 不参与，只给编辑器和 vue-tsc 用）：

    /** @param {import('agent-extension').App} app *\
    export default app => { ... }

形状必须与 Extension.ts 的 scope() / api.ts / extensions/shell/frontend/api.js 逐一对齐，改实现时同步这里。
*/

import type { Component } from 'vue'
import type { API } from './api'
import type { Agent } from './Agent'
// 扩展往各登记表里放的条目。
export interface PlusItem { id: string; label: string; run: () => void }
export interface SettingForm { id: string; title: string; description?: string; note?: string; fields?: unknown }
export interface Panel { id: string; title: string; component: Component }

// 图标数据（@hugeicons/core-free-icons 的导出是对象或 readonly 元组数组），交给 Components.Icon 渲染。
export type IconData = Record<string, unknown> | readonly unknown[]

// 壳上的槽位（见 extensions/shell/frontend/api.js）。
export interface ShellTab { id: string; title: string }
export interface ShellPage {
  id: string
  title: string
  parent?: string
  group?: string
  order?: number
  tone?: string
  icon?: IconData
  description?: string
  component: Component
  ids?: string[]
}
export interface ShellHeaderItem { id: string; icon?: IconData; label: string; title?: string; component?: Component; run?: () => void }
export interface ShellBarItem { id: string; place: 'start' | 'tabs' | 'end'; icon?: IconData; label: string; title?: string; run?: () => void }
export interface ShellOverlay { id: string; component: Component }
export interface ShellLookupItem { id: string; title?: string }

export interface ShellState {
  hash: string
  page: string             // home | session | settings | 其他 pages.id
  session: string
  category: string         // 设置页当前分类（#/settings/<分类>/<详情>）
  title: string
  side: string             // 对话顶栏打开的侧栏 id（todo 等）
  back: string
  tabs: ShellTab[]
  pages: ShellPage[]
  header: ShellHeaderItem[]
  start: ShellBarItem[]
  end: ShellBarItem[]
  extras: ShellBarItem[]
  overlays: ShellOverlay[]
}

export interface ShellApi {
  state: ShellState
  session: string
  category: string
  go(hash: string): void
  tabs: {
    list: ShellTab[]
    open(id: string, title?: string): void
    close(id: string): void
    rename(id: string, title: string): void
    restore(find?: (id: string) => Promise<ShellLookupItem | undefined | null> | ShellLookupItem | undefined | null): Promise<void>
  }
  header: { list: ShellHeaderItem[]; add(item: ShellHeaderItem): () => void; toggle(id: string): void }
  pages: { list: ShellPage[]; add(item: ShellPage): () => void; open(id: string): void }
  bar: { add(item: ShellBarItem): () => void }
  overlay: { add(item: ShellOverlay): () => void }
  listen(): () => void
}

// 宿主共享表：main.ts 造好 Agent / API / History / Components，Extension.load 补 Panels / Settings，
// shell 扩展挂 shell。没有壳时 shell 为 undefined，扩展要用可选链。
export interface Shared {
  Agent: typeof Agent
  API: typeof API
  History: { group(state: typeof Agent['state']): unknown[] }
  Components: Record<string, Component>
  Panels?: Panel[]
  Settings?: SettingForm[]
  shell?: ShellApi
}

// api.ts 的 API 是 const；这里把它变成类型，扩展作者写 app.api 时有完整推导。
export type ApiInstance = typeof API

// 每个扩展 frontend/index.js 的 default(app) 收到的对象（Extension.ts 的 scope 返回值）。
export interface App {
  name: string
  shared: Shared
  api: ApiInstance
  /** 包任意导出对象上的方法，返回撤掉这一层的函数。 */
  patch(target: object, key: string, wrap: (original: any) => any): () => void
  /** 收后端扩展推送（ctx.push 发来的 <扩展名>.<事件>）。 */
  on(event: string, handler: (data: any) => void): void
  components: { wrap(key: string, wrap: (Original: Component) => Component): () => void }
  toolViews: { add(toolName: string, view: Component): void }
  shell: ShellApi | undefined
  plus: { add(item: PlusItem): void }
  settings: { add(form: SettingForm): void }
  panels: { add(panel: Panel): void }
  style(css: string): void
}

// 设置页 UI kit（settings 扩展的 ui.js），设置分类组件的 props.ui。
export interface UiKit {
  Icon: Component
  List: Component
  Row: Component
  Card: Component
  Switch: Component
  Field: Component
  Select: Component
  Segmented: Component
  Empty: Component
}

// 设置分类组件的 props.nav：进详情、返回上一级。
export interface SettingsNav { open(detail: string): void; back(): void }

// ToolCall 内容区（app.toolViews 登记的组件）收到的 props.step，
// 就是 History.group 产出的 Step 的 tool 分支，实现在 src/history.ts。
export type ToolStep = Extract<import('./history').Step, { kind: 'tool' }>
