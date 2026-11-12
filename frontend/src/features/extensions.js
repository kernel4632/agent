/*
 * 扩展前端加载器：启动时从后端拉取已加载的扩展列表，动态加载每个扩展的前端代码。
 *
 * 后端通过 /admin 的 extension.list 返回 { loaded, failed, changed }：
 *   loaded  — 已加载的扩展名
 *   failed  — 加载失败的扩展
 *   changed  — 代码有变化但还没重载的扩展，前端弹出提示让用户点击重载
 *
 * 扩展前端代码由后端 Bun.build 打包成 ES module（.vue 会被编译），前端用 Blob URL +
 * 动态 import() 加载，调用扩展导出的函数，传入 app 对象。
 *
 * app 对象是扩展能用的全部能力：
 *   app.vue       — Vue 的 ref、computed、watch 等
 *   app.ui         — 框架的 UI 组件（Button、Switch、Dialog 等）
 *   app.api        — 调 /admin 的 op
 *   app.settings.add(page)   — 往设置页加一个页面
 *   app.toolViews.add(name, component) — 自定义某个工具结果的渲染
 *   app.style(css) — 注入扩展自己的样式
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
import { Notice } from '../utils/notice.js'

// --- 扩展注册表 ---
export const extensionSettings = ref([])      // 设置页条目
export const extensionToolViews = {}          // 工具名 -> Vue 组件
export const extensionState = ref({ loaded: [], failed: [], changed: [] })
export const extensionReloadHint = ref('')   // 有变化时显示的提示文字

// --- 创建给扩展用的 app 对象 ---
const createApp = () => ({
    vue: { ref, computed, watch, onMounted, onBeforeUnmount, defineComponent, h },
    ui: { Button, Switch, Dialog, Field, Select, Icon, Fold, Checkbox, Tabs, SettingsList, SettingsRow },
    api: (op, args = {}) => fetch('/api/admin', {
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
        // 开始轮询扩展变化
        startPolling()
    } catch (error) {
        console.error('[extensions] 获取扩展列表失败：', error)
    }
}

// --- 加载单个扩展的前端代码 ---
// 用 new Function 而不是 Blob URL import：不受 CSP 限制，不需要浏览器支持动态 import
const loadOne = async name => {
    const code = await AgentAPI.getExtensionFrontend(name)
    if (!code || typeof code !== 'string') return

    // 打包后的代码结构：一堆 const 声明 + function frontend_default(app) {...} + export {...}
    // 去掉所有 export 语句，把入口函数找出来在末尾调用
    let browserCode = code
        .replace(/export\s*\{[^}]+}\s*;?/g, '')           // 去掉 export { ... }
        .replace(/export\s+default\s+/g, '')                // 去掉 export default
    // 找到入口函数名（Bun.build 生成的默认叫 xxx_default）
    const entryMatch = browserCode.match(/(?:async\s+)?function\s+(\w+_default)\s*\(\s*app\s*\)/)
    if (entryMatch) {
        browserCode += `\n;return ${entryMatch[1]}(app);`
    } else {
        // 备选：找任何接收 app 参数的函数
        const fallback = browserCode.match(/(?:async\s+)?function\s+(\w+)\s*\(\s*app\s*\)/)
        if (fallback) browserCode += `\n;return ${fallback[1]}(app);`
    }

    try {
        const fn = new Function('app', browserCode)
        const app = createApp()
        await fn(app)
        console.log(`[extensions] ${name} 前端已加载`)
    } catch (error) {
        console.error(`[extensions] ${name} 前端加载失败：`, error)
    }
}

// --- 轮询扩展变化状态（每 5 秒查一次，开销极小） ---
let pollTimer = null
const startPolling = () => {
    if (pollTimer) return
    pollTimer = setInterval(async () => {
        try {
            const result = await AgentAPI.getExtensions()
            extensionState.value = result
            const changed = result.changed || []
            if (changed.length) {
                extensionReloadHint.value = `扩展 ${changed.join(', ')} 已更新，点击重载`
            } else {
                extensionReloadHint.value = ''
            }
        } catch { /* 后端没起来就跳过 */ }
    }, 5000)
}

// --- 重载扩展（用户点击提示后调） ---
const reload = async name => {
    try {
        await AgentAPI.reloadExtension(name)
        // 重新加载前端代码
        await loadOne(name)
        // 刷新状态
        const result = await AgentAPI.getExtensions()
        extensionState.value = result
        if (!result.changed?.length) extensionReloadHint.value = ''
        Notice.show(`扩展 ${name} 已重载`)
    } catch (error) {
        Notice.show(`重载失败：${error.message}`)
    }
}

export const Extensions = { init, reload }
