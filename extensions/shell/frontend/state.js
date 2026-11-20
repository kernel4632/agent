/*
壳的全部界面状态：当前页、已打开的标签、各扩展登记的入口。
业务数据（会话列表、设置表单）不放这里，由对应扩展自己管。
*/

import { reactive } from 'vue'

export const state = reactive({
    hash: '',
    page: 'home',          // home | session | settings | 其他 pages.id
    session: '',
    title: '',
    side: '',              // 对话顶栏打开的侧栏 id（todo 等）
    back: '#/',
    tabs: [],              // { id, title }
    pages: [],             // { id, title, parent?, component }
    header: [],            // { id, icon?, label, title?, run?, component? }
    start: [],             // 顶栏左侧入口（会话），{ id, icon?, label, run }
    end: [],               // 顶栏右侧入口（设置）
    extras: [],            // 标签右侧按钮（新会话 +）
    overlays: [],          // 内容区浮层（权限询问）
})

export function parse(hash) {
    const raw = String(hash || '').replace(/^#/, '') || '/'
    const path = raw.startsWith('/') ? raw : `/${raw}`
    const parts = path.split('/').filter(Boolean)
    if (parts[0] === 's' && parts[1]) return { page: 'session', session: parts[1], hash: `#/s/${parts[1]}`, category: '' }
    if (parts[0] === 'settings') return { page: 'settings', session: '', hash: path === '/settings' ? '#/settings' : `#${path}`, category: parts.slice(1).join('/') }
    if (parts[0] && parts[0] !== 'home') return { page: parts[0], session: '', hash: `#${path}`, category: parts.slice(1).join('/') }
    return { page: 'home', session: '', hash: '#/', category: '' }
}

const KEY = 'agent.openTabs'

export function remember(ids) {
    try { sessionStorage.setItem(KEY, JSON.stringify(ids)) } catch { /* 私密模式就只留这一次 */ }
}

export function recalled() {
    try {
        const value = JSON.parse(sessionStorage.getItem(KEY) || '[]')
        return Array.isArray(value) ? value.filter(id => typeof id === 'string') : []
    } catch { return [] }
}
