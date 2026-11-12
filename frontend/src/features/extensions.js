/*
 * 扩展前端加载器：拉取正在生效的扩展的打包代码，用 new Function 执行，并记下每个扩展注册了什么。
 *
 * 用 new Function 而不是 Blob URL import：不受 WebView CSP 限制。
 * 后端已把打包代码里的 `import ... from "vue"` / `"@app/..."` 换成 __agentVue__ / __agentApp__，
 * 这两个变量由这里通过参数传入。
 *
 * 扩展入口拿到的 app：
 *   app.settings.add(page)                 — 往设置页加一个页面
 *   app.toolViews.add(toolName, component) — 自定义某个工具结果的渲染
 *   app.api(op, args)                      — 调 /admin 的 op
 *   app.style(css)                         — 注入扩展样式
 * 每个扩展的注册都记在 owned 里，关闭或重载时整体撤掉，不留残余。
 *
 * 调用示例：
 *   await Extensions.init(sharedModules)       // main.js 启动时
 *   await Extensions.toggle('skill', false)    // 设置页的开关
 *   await Extensions.reload('skill')
 */

import * as Vue from 'vue'
import { ref, reactive, markRaw } from 'vue'
import { AgentAPI } from '../utils/api.js'
import { Notice } from '../utils/notice.js'

const agentVue = Vue           // 模板编译出的渲染函数要用 openBlock 等整套辅助函数
let agentApp = {}              // 框架模块表（'ui/Button.vue' → 组件），由 main.js 组装后传入

// --- 注册表：设置页、工具结果视图、聊天面板、顶栏按钮都从这里取 ---
export const extensionSettings = ref([])
export const extensionToolViews = reactive({})
export const extensionPanels = ref([])           // 聊天区右侧面板：{ id, icon, label, component, props?, visible? }
export const extensionTopbarItems = ref([])      // 顶栏图标按钮：{ id, icon, label, active?, onClick }
export const extensionState = ref({ extensions: [], loaded: [], changed: [] })

const owned = new Map()        // 扩展名 → { pages: [], toolViews: [], panels: [], topbarItems: [], styles: [] }

// --- 给一个扩展的 app：注册的东西都记到它名下 ---
const createApp = name => {
    const mine = { pages: [], toolViews: [], panels: [], topbarItems: [], styles: [] }
    owned.set(name, mine)
    return {
        name,
        api: (op, args = {}) => fetch('/api/admin', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ op, ...args }),
        }).then(r => r.json()),
        settings: {
            add(page) {
                extensionSettings.value = [...extensionSettings.value.filter(p => p.id !== page.id), { ...page, component: markRaw(page.component), extension: name }]
                mine.pages.push(page.id)
            },
        },
        toolViews: {
            add(toolName, component) {
                extensionToolViews[toolName] = markRaw(component)
                mine.toolViews.push(toolName)
            },
        },
        panels: {
            add(panel) {
                extensionPanels.value = [...extensionPanels.value.filter(p => p.id !== panel.id), { ...panel, component: markRaw(panel.component), extension: name }]
                mine.panels.push(panel.id)
            },
        },
        topbar: {
            add(item) {
                extensionTopbarItems.value = [...extensionTopbarItems.value.filter(i => i.id !== item.id), { ...item, extension: name }]
                mine.topbarItems.push(item.id)
            },
        },
        style(css) {
            const el = document.createElement('style')
            el.dataset.extension = name
            el.textContent = css
            document.head.appendChild(el)
            mine.styles.push(true)
        },
    }
}

// --- 撤掉一个扩展在前端注册的所有东西 ---
const unloadOne = name => {
    const mine = owned.get(name)
    if (mine) {
        extensionSettings.value = extensionSettings.value.filter(p => p.extension !== name)
        extensionPanels.value = extensionPanels.value.filter(p => p.extension !== name)
        extensionTopbarItems.value = extensionTopbarItems.value.filter(i => i.extension !== name)
        for (const toolName of mine.toolViews) delete extensionToolViews[toolName]
        owned.delete(name)
    }
    document.querySelectorAll(`style[data-extension="${CSS.escape(name)}"]`).forEach(el => el.remove())
}

// --- 加载一个扩展的前端代码 ---
const loadOne = async name => {
    unloadOne(name)
    const { code } = await AgentAPI.getExtensionFrontend(name)
    if (!code || typeof code !== 'string') return   // 这个扩展没有前端部分

    let body = code
        .replace(/export\s*\{[^}]+\}\s*;?/g, '')
        .replace(/export\s+default\s+/g, '')
    const entry = body.match(/(?:async\s+)?function\s+(\w+_default)\s*\(\s*app\s*\)/)
        || body.match(/(?:async\s+)?function\s+(\w+)\s*\(\s*app\s*\)/)
    if (!entry) throw new Error('找不到前端入口函数（export default function (app) {...}）')
    body += `\n;return ${entry[1]}(app);`

    try {
        const fn = new Function('app', '__agentVue__', '__agentApp__', '__agentExtension__', body)
        await fn(createApp(name), agentVue, agentApp, name)
        console.log(`[extensions] ${name} 前端已加载`)
    } catch (error) {
        unloadOne(name)
        throw error
    }
}

// --- 按后端清单同步：在跑的加载，停掉的撤掉 ---
const sync = async state => {
    extensionState.value = state
    const running = new Set(state.loaded || [])
    for (const name of [...owned.keys()]) if (!running.has(name)) unloadOne(name)
    for (const item of state.extensions || []) {
        if (!item.running || !item.hasFrontend || owned.has(item.name)) continue
        try { await loadOne(item.name) }
        catch (error) { console.error(`[extensions] ${item.name} 前端加载失败：`, error) }
    }
}

// --- 轮询代码变化：发现新改动就弹一次提示，点按钮重载 ---
let pollTimer = null
let notified = new Set()
const poll = async () => {
    try {
        const state = await AgentAPI.getExtensions()
        extensionState.value = state
        const fresh = (state.changed || []).filter(name => !notified.has(name))
        notified = new Set(state.changed || [])
        if (fresh.length) {
            Notice.show({
                message: `扩展 ${fresh.join('、')} 的代码有更新`,
                action: { label: '重载', run: () => Promise.all(fresh.map(name => reload(name))) },
            })
        }
    } catch { /* 后端暂时连不上就下次再查 */ }
}

const init = async (shared = {}) => {
    agentApp = shared
    try { await sync(await AgentAPI.getExtensions()) }
    catch (error) { console.error('[extensions] 获取扩展列表失败：', error) }
    if (!pollTimer) pollTimer = setInterval(poll, 5000)
}

// --- 设置页的开关和重载按钮 ---
const toggle = async (name, enabled) => {
    try {
        await sync(await AgentAPI.toggleExtension(name, enabled))
        return true
    } catch (error) {
        Notice.show(`切换失败：${error.message}`)
        return false
    }
}

const reload = async name => {
    try {
        const state = await AgentAPI.reloadExtension(name)
        for (const item of state.extensions || []) if (item.name === name || item.requires?.includes(name)) unloadOne(item.name)
        await sync(state)
        notified.delete(name)
        Notice.show(`扩展 ${name} 已重载`)
        return true
    } catch (error) {
        Notice.show(`重载失败：${error.message}`)
        return false
    }
}

const refresh = async () => sync(await AgentAPI.getExtensions())

export const Extensions = { init, toggle, reload, refresh }
