/*
 * 扩展前端加载器：从后端拉取已加载扩展的打包代码，用 new Function 执行。
 *
 * 用 new Function 而不是 Blob URL import：
 *   - 不受 Wails WebView CSP 限制
 *   - 不依赖浏览器支持动态 import()
 *
 * 后端打包代码里的 `import { x as y } from "vue"` 和 `import X from "@app/..."` 已被
 * 后端替换成 `const { x: y } = __agentVue__` 和 `const X = __agentApp__[...].default`，
 * 这两个变量通过 new Function 参数传入，不走 window 全局。
 *
 * app 对象是扩展能用的全部能力：
 *   app.settings.add(page)                — 往设置页加一个页面
 *   app.toolViews.add(toolName, component) — 自定义工具结果渲染
 *   app.api(op, args)                     — 调 /admin 的 op
 *   app.style(css)                        — 注入扩展样式
 */

import { ref, computed, watch, onMounted, onBeforeUnmount, defineComponent, h,
    nextTick, provide, inject, toRef, toRefs, unref, watchEffect, reactive } from 'vue'
import Button from '../ui/Button.vue'
import Switch from '../ui/Switch.vue'
import Dialog from '../ui/Dialog.vue'
import Field from '../ui/Field.vue'
import Select from '../ui/Select.vue'
import Icon from '../ui/Icon.vue'
import Fold from '../ui/Fold.vue'
import Checkbox from '../ui/Checkbox.vue'
import Tabs from '../ui/Tabs.vue'
import SettingsList from '../ui/SettingsList.vue'
import SettingsRow from '../ui/SettingsRow.vue'
import PathInput from '../ui/PathInput.vue'
import Markdown from '../ui/Markdown.vue'
import SelectButton from '../ui/SelectButton.vue'
import Menu from '../ui/Menu.vue'
import { AgentAPI } from '../utils/api.js'
import { Notice } from '../utils/notice.js'
import { store } from '../store.js'

// --- 传给扩展代码的两个参数（代替 window 全局）---
const agentVue = {
    ref, computed, watch, onMounted, onBeforeUnmount, defineComponent, h,
    nextTick, provide, inject, toRef, toRefs, unref, watchEffect, reactive,
}
const agentApp = {
    'ui/Button.vue':      Button,
    'ui/Switch.vue':      Switch,
    'ui/Dialog.vue':      Dialog,
    'ui/Field.vue':       Field,
    'ui/Select.vue':      Select,
    'ui/Icon.vue':        Icon,
    'ui/Fold.vue':        Fold,
    'ui/Checkbox.vue':    Checkbox,
    'ui/Tabs.vue':        Tabs,
    'ui/SettingsList.vue':SettingsList,
    'ui/SettingsRow.vue': SettingsRow,
    'ui/PathInput.vue':   PathInput,
    'ui/Markdown.vue':    Markdown,
    'ui/SelectButton.vue':SelectButton,
    'ui/Menu.vue':        Menu,
    'utils/api.js':       { AgentAPI },
    'utils/notice.js':    { Notice },
    'store.js':           { store },
}

// --- 扩展注册表 ---
export const extensionSettings  = ref([])
export const extensionToolViews = {}
export const extensionState     = ref({ loaded: [], failed: [], changed: [] })
export const extensionReloadHint = ref('')

// --- app 对象：扩展通过它注册能力 ---
const createApp = () => ({
    api: (op, args = {}) => fetch('/api/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op, ...args }),
    }).then(r => r.json()),
    settings: {
        add:    page => extensionSettings.value.push(page),
        remove: id   => { const i = extensionSettings.value.findIndex(p => p.id === id); if (i >= 0) extensionSettings.value.splice(i, 1) },
    },
    toolViews: {
        add:    (name, component) => { extensionToolViews[name] = component },
        remove: name              => { delete extensionToolViews[name] },
    },
    style(css) {
        const el = document.createElement('style')
        el.textContent = css
        document.head.appendChild(el)
    },
})

// --- 加载所有扩展的前端代码 ---
const init = async () => {
    try {
        const result = await AgentAPI.getExtensions()
        extensionState.value = result
        for (const name of result.loaded || []) {
            try { await loadOne(name) }
            catch (err) { console.error(`[extensions] ${name} 前端加载失败：`, err) }
        }
        startPolling()
    } catch (err) {
        console.error('[extensions] 获取扩展列表失败：', err)
    }
}

// --- 加载单个扩展的前端代码 ---
const loadOne = async name => {
    const code = await AgentAPI.getExtensionFrontend(name)
    if (!code || typeof code !== 'string') return

    // 去掉 export 语句，找到入口函数，末尾加 return 调用
    let fn_code = code
        .replace(/export\s*\{[^}]+\}\s*;?/g, '')
        .replace(/export\s+default\s+/g, '')

    const entryMatch = fn_code.match(/(?:async\s+)?function\s+(\w+_default)\s*\(\s*app\s*\)/)
        || fn_code.match(/(?:async\s+)?function\s+(\w+)\s*\(\s*app\s*\)/)
    if (!entryMatch) {
        console.error(`[extensions] ${name}: 找不到入口函数`)
        return
    }
    fn_code += `\n;return ${entryMatch[1]}(app);`

    try {
        // __agentVue__ 和 __agentApp__ 通过参数传入，不走 window 全局
        const fn = new Function('app', '__agentVue__', '__agentApp__', fn_code)
        await fn(createApp(), agentVue, agentApp)
        console.log(`[extensions] ${name} 前端已加载`)
    } catch (err) {
        console.error(`[extensions] ${name} 前端加载失败：`, err)
    }
}

// --- 轮询变化（每 5 秒查一次）---
let pollTimer = null
const startPolling = () => {
    if (pollTimer) return
    pollTimer = setInterval(async () => {
        try {
            const result = await AgentAPI.getExtensions()
            extensionState.value = result
            const changed = result.changed || []
            extensionReloadHint.value = changed.length
                ? `扩展 ${changed.join(', ')} 已更新，点击重载`
                : ''
        } catch { /* 后端没起来就跳过 */ }
    }, 5000)
}

// --- 重载扩展 ---
const reload = async name => {
    try {
        await AgentAPI.reloadExtension(name)
        await loadOne(name)
        const result = await AgentAPI.getExtensions()
        extensionState.value = result
        if (!result.changed?.length) extensionReloadHint.value = ''
        Notice.show(`扩展 ${name} 已重载`)
    } catch (err) {
        Notice.show(`重载失败：${err.message}`)
    }
}

export const Extensions = { init, reload }
