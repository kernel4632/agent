/*
 * 扩展前端加载器：启动时从后端拉取已加载的扩展列表，动态加载每个扩展的前端代码。
 *
 * 后端通过 /admin 的 extension.list 返回已加载的扩展名，
 * extension.frontend 返回扩展前端代码（由后端 Bun.build 打包好的 ES module）。
 * 前端用 Blob URL + 动态 import() 加载代码，调用扩展导出的函数，传入 app 对象。
 *
 * app 对象是扩展能用的全部能力：
 *   app.vue       — Vue 的 ref、computed、watch 等
 *   app.ui         — 框架的 UI 组件（Button、Switch、Dialog 等）
 *   app.api        — 调 /admin 的 op
 *   app.settings.add(page)   — 往设置页加一个页面
 *   app.toolViews.add(name, component) — 自定义某个工具结果的渲染
 *   app.style(css) — 注入扩展自己的样式
 *
 * 调用示例：
 *   await Extensions.init()   // main.js 启动时调一次
 */

import { ref, computed, watch, onMounted, onBeforeUnmount, defineComponent, h } from 'vue'
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
import { AgentAPI } from '../utils/api.js'

// --- 扩展注册表：设置页和工具视图都从这里取 ---
export const extensionSettings = ref([])      // 设置页条目
export const extensionToolViews = {}          // 工具名 -> Vue 组件
export const extensionState = ref({ loaded: [], failed: [] })

// --- 创建给扩展用的 app 对象 ---
const createApp = () => ({
    vue: { ref, computed, watch, onMounted, onBeforeUnmount, defineComponent, h },
    ui: { Button, Switch, Dialog, Field, Select, Icon, Fold, Checkbox, Tabs, SettingsList, SettingsRow },
    api: (op, args = {}) => fetch('/api/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op, ...args }),
    }).then(r => r.json()),
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op, ...args }),
    }).then(r => r.json()),
    settings: {
        add(page) { extensionSettings.value.push(page) },
        remove(id) {
            const idx = extensionSettings.value.findIndex(p => p.id === id)
            if (idx >= 0) extensionSettings.value.splice(idx, 1)
        },
    },
    toolViews: {
        add(name, component) { extensionToolViews[name] = component },
        remove(name) { delete extensionToolViews[name] },
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
        for (const name of result.loaded) {
            try {
                await loadOne(name)
            } catch (error) {
                console.error(`[extensions] ${name} 前端加载失败：`, error)
            }
        }
    } catch (error) {
        console.error('[extensions] 获取扩展列表失败：', error)
    }
}

// --- 加载单个扩展的前端代码 ---
const loadOne = async name => {
    const code = await AgentAPI.getExtensionFrontend(name)
    if (!code || typeof code !== 'string') return   // 没有前端代码，跳过

    // 用 Blob URL 让浏览器原生 import
    const blob = new Blob([code], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    try {
        const mod = await import(url)
        const init = mod.default
        if (typeof init === 'function') {
            const app = createApp()
            await init(app)
            console.log(`[extensions] ${name} 前端已加载`)
        }
    } finally {
        URL.revokeObjectURL(url)
    }
}

export const Extensions = { init }
