/*
扩展加载、patch、组件表：前端唯一懂扩展的地方。本体只从这里的表里取组件，不知道谁改过它。

- 组件表 Components：本体启动时登记；扩展换掉某一项或在外面包一层，多个扩展按加载顺序叠，后加载的在外层。
- ToolViews：按工具名替换 ToolCall 的内容区（diff、shell 实时输出等）。
- PlusMenu：加号菜单的追加项。原版加号只负责上传文件；设置、会话、任务等不要再往这里塞，改走 app.shell。
- app.shell：由 shell 扩展挂上，提供 tabs / header / pages / bar / overlay。没有壳时为 undefined。
- patch：包任意导出对象上的方法（Agent.send、History.group……），每层外面有兜底，扩展抛错就跳过这一层。
每个扩展做过的改动都记在它名下，拔出时整体撤掉，再从原方法重新叠。

调用示例（扩展的 frontend/index.js）：
    export default app => {
      app.patch(app.shared.History, 'group', original => state => original(state).filter(...))
      app.components.wrap('ToolCall', Original => defineComponent(...))
      app.toolViews.add('shell', ShellView)
      app.shell.pages.add({ id: 'home', component: Home })
    }
*/

import { markRaw, reactive, type Component } from 'vue'
import { API } from './api'

export interface PlusItem { id: string; label: string; run: () => void }
export interface SettingForm { id: string; title: string; fields?: unknown }
export interface Panel { id: string; title: string; component: Component }
type Wrap = (original: any) => any
interface Layer { owner: string; wrap: Wrap }

export const Components = reactive({}) as Record<string, Component>
export const ToolViews = reactive({}) as Record<string, Component>
export const PlusMenu = reactive([]) as PlusItem[]
export const Settings = reactive([]) as SettingForm[]
export const Panels = reactive([]) as Panel[]
// 扩展页用：每个扩展的状态，以及它包了哪些点。
export const Loaded = reactive([]) as { name: string; patched: string[]; error?: string }[]

const chains = new Map<object, Map<string, { original: any; layers: Layer[] }>>()
const undo = new Map<string, (() => void)[]>()
const listeners = new Map<string, Set<(data: unknown) => void>>()

// 按层重新叠出 target[key]：函数每层外面加兜底，组件直接替换。
function stack(target: any, key: string) {
  const chain = chains.get(target)!.get(key)!
  target[key] = chain.layers.reduce((below, layer) => {
    const above = layer.wrap(below)
    if (typeof below !== 'function' || typeof above !== 'function') return markRaw(above)
    return (...args: unknown[]) => {
      try { return above(...args) } catch (error) {
        const record = Loaded.find(item => item.name === layer.owner)
        if (record) record.error = String(error)
        return below(...args)
      }
    }
  }, chain.original)
}

function patch(target: any, key: string, wrap: Wrap, owner = 'app') {
  if (!(key in target)) throw new Error(`patch 目标不存在：${key}`)
  const table = chains.get(target) ?? new Map()
  chains.set(target, table)
  if (!table.has(key)) table.set(key, { original: target[key], layers: [] })
  const layer = { owner, wrap }
  table.get(key)!.layers.push(layer)
  stack(target, key)
  const remove = () => { const chain = table.get(key)!; chain.layers = chain.layers.filter((item: Layer) => item !== layer); stack(target, key) }
  undo.get(owner)?.push(remove)
  return remove
}

// 扩展入口拿到的 app：所有便捷写法都落到 patch 或登记上，并记在这个扩展名下。
function scope(name: string, shared: Record<string, unknown>) {
  const record = { name, patched: [] as string[] }
  Loaded.push(record)
  undo.set(name, [])
  const own = (fn: () => void) => undo.get(name)!.push(fn)
  return {
    name, shared, api: API,
    patch: (target: object, key: string, wrap: Wrap) => { record.patched.push(key); return patch(target, key, wrap, name) },
    on(event: string, handler: (data: unknown) => void) {
      const set = listeners.get(event) ?? new Set()
      set.add(handler)
      listeners.set(event, set)
      own(() => set.delete(handler))
    },
    components: {
      wrap: (key: string, wrap: (Original: Component) => Component) => { record.patched.push(`组件 ${key}`); return patch(Components, key, wrap, name) },
    },
    toolViews: { add(toolName: string, view: Component) { ToolViews[toolName] = markRaw(view); own(() => delete ToolViews[toolName]) } },
    get shell() { return shared.shell as any },
    plus: { add(item: PlusItem) { PlusMenu.push(item); own(() => PlusMenu.splice(PlusMenu.indexOf(item), 1)) } },
    settings: { add(form: SettingForm) { Settings.push(form); own(() => { const index = Settings.indexOf(form); if (index >= 0) Settings.splice(index, 1) }) } },
    panels: { add(panel: Panel) { const item = { ...panel, component: markRaw(panel.component) }; Panels.push(item); own(() => { const index = Panels.indexOf(item); if (index >= 0) Panels.splice(index, 1) }) } },
    style(css: string) { const element = Object.assign(document.createElement('style'), { textContent: css }); document.head.append(element); own(() => element.remove()) },
  }
}

// 撤掉一个扩展的全部改动（逆序），并从扩展列表里拿掉。
function unload(name: string) {
  for (const fn of (undo.get(name) ?? []).reverse()) fn()
  undo.delete(name)
  Loaded.splice(Loaded.findIndex(item => item.name === name), 1)
}

export const Extension = {
  patch,
  unload,
  // 把后端扩展推送分发给还在生效的 app.on 监听。
  dispatch(name: string, data: unknown) { for (const handler of listeners.get(name) ?? []) handler(data) },
  // 本体启动时登记组件：只登记一次，扩展改的是登记后的表项。
  register(table: Record<string, Component>) { for (const [key, value] of Object.entries(table)) Components[key] = markRaw(value) },
  // 按后端给的顺序加载；某个扩展启动失败就撤掉它已做的改动，继续加载下一个。
  async load(shared: Record<string, unknown>) {
    shared.Panels = Panels
    shared.Settings = Settings
    const entries = await API.extensions().catch(() => [])
    for (const entry of entries) {
      try { const module = await import(/* @vite-ignore */ entry.url); await module.default(scope(entry.name, shared)) } catch (error) {
        unload(entry.name)
        Loaded.push({ name: entry.name, patched: [], error: String(error) })
      }
    }
  },
}
