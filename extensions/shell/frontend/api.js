/*
给其他扩展用的壳接口，挂在 app.shell / app.shared.shell 上：

    app.shell.go('#/s/abc')
    app.shell.tabs.open(id, title) / close(id) / rename(id, title)
    app.shell.header.add({ id, label, title, component?, run? })
    app.shell.pages.add({ id, title, parent?, component })
    app.shell.bar.add({ id, place: 'start' | 'tabs' | 'end', label, title?, run })
    app.shell.overlay.add({ id, component })

壳自己不创建会话、不读设置；只负责顶栏、页面槽和路由。
地址约定：#/ 会话列表，#/s/<id> 已打开的对话，#/settings 或 #/settings/<分类> 设置页。
*/

import { markRaw } from 'vue'
import { parse, recalled, remember, state } from './state.js'

function stash() {
    remember(state.tabs.map(item => item.id))
}

function apply(hash, app) {
    const next = parse(hash)
    if (state.page !== 'settings' && next.page === 'settings') state.back = state.hash || '#/'
    Object.assign(state, { hash: next.hash, page: next.page, session: next.session, side: next.page === 'session' ? state.side : '' })
    if (next.page === 'session' && next.session) {
        if (!state.tabs.some(item => item.id === next.session)) state.tabs.push({ id: next.session, title: state.title || '会话' })
        const tab = state.tabs.find(item => item.id === next.session)
        state.title = tab?.title || '会话'
        stash()
        app.shared.Agent?.connect(next.session)
    }
}

export function create(app) {
    const own = (list, item) => {
        list.push(item)
        return () => {
            const index = list.indexOf(item)
            if (index >= 0) list.splice(index, 1)
        }
    }

    const shell = {
        get state() { return state },
        get session() { return state.session },
        get category() { return parse(location.hash).category },

        go(hash) {
            const next = parse(hash).hash
            if (location.hash !== next) location.hash = next
            else apply(next, app)
        },

        tabs: {
            list: state.tabs,
            open(id, title) {
                if (!id) return
                const hit = state.tabs.find(item => item.id === id)
                if (hit) { if (title) hit.title = title }
                else state.tabs.push({ id, title: title || '会话' })
                stash()
                shell.go(`#/s/${id}`)
            },
            close(id) {
                const index = state.tabs.findIndex(item => item.id === id)
                if (index < 0) return
                state.tabs.splice(index, 1)
                stash()
                if (state.session !== id) return
                const neighbor = state.tabs[index] || state.tabs[index - 1]
                if (neighbor) shell.go(`#/s/${neighbor.id}`)
                else shell.go('#/')
            },
            rename(id, title) {
                const tab = state.tabs.find(item => item.id === id)
                if (tab) tab.title = title
                if (state.session === id) state.title = title
            },
            async restore(lookup) {
                const wanted = recalled()
                const hash = parse(location.hash)
                const find = async id => lookup ? await lookup(id) : { id, title: '会话' }
                if (hash.session) {
                    const meta = await find(hash.session)
                    if (!meta) {
                        if (location.hash && location.hash !== '#/') location.hash = '#/'
                        apply('#/', app)
                        return
                    }
                    if (!wanted.includes(hash.session)) wanted.push(hash.session)
                }
                for (const id of wanted) {
                    if (state.tabs.some(item => item.id === id)) continue
                    const meta = await find(id)
                    if (meta) state.tabs.push({ id, title: meta.title || '会话' })
                }
                stash()
                apply(location.hash, app)
            },
        },

        header: {
            list: state.header,
            add(item) { return own(state.header, { ...item, component: item.component ? markRaw(item.component) : undefined }) },
            toggle(id) { state.side = state.side === id ? '' : id },
        },

        pages: {
            list: state.pages,
            add(item) { return own(state.pages, { ...item, component: markRaw(item.component) }) },
            open(id) { shell.go(id === 'home' ? '#/' : `#/${id}`) },
        },

        bar: {
            add(item) {
                const place = item.place === 'end' ? state.end : item.place === 'tabs' ? state.extras : state.start
                return own(place, item)
            },
        },

        overlay: {
            add(item) { return own(state.overlays, { ...item, component: markRaw(item.component) }) },
        },

        listen() {
            const onHash = () => apply(location.hash, app)
            window.addEventListener('hashchange', onHash)
            apply(location.hash, app)
            return () => window.removeEventListener('hashchange', onHash)
        },
    }

    return shell
}
