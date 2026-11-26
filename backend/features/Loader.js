/*
扩展加载器：扫描项目 extensions/ 与 ~/.agents/extensions，按 requires 拓扑、再按 after 调整，
逐个执行 backend.js。协议版本对不上、依赖缺失、循环依赖或启动失败的，记下原因并撤掉已做改动，不挡住开机。
被依赖的扩展停用时，依赖它的跟着停。前端入口按需打包。
*/

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Extension } from './Extension.js'
import { Bundle } from './Bundle.js'
import { Store } from './Store.js'

export const BASE = 1                                                     // 本基座的扩展协议版本
const root = join(import.meta.dir, '../..')
const loaded = new Map()                                                 // name -> { name, folder, manifest, error?, frontend? }

async function exists(path) {
    try { await stat(path); return true } catch { return false }
}

async function scan(dir) {
    if (!await exists(dir)) return []
    const entries = []
    for (const name of await readdir(dir)) {
        const folder = join(dir, name)
        if (!(await stat(folder).catch(() => null))?.isDirectory()) continue
        if (!await exists(join(folder, 'manifest.json'))) continue
        const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'))
        entries.push({ name: manifest.name ?? name, version: manifest.version, manifest, folder })
    }
    return entries
}

function compatible(manifest) {
    if (manifest.base === undefined) return true
    const base = Number(manifest.base)
    return Number.isFinite(base) && base === BASE
}

// requires 是硬边：缺了或上游没启动，自己也不启动。after 在对方也在集合里时是软边。同级按名字排。
function sort(entries) {
    const byName = new Map(entries.map(item => [item.name, item]))
    const fail = []
    const blocked = new Set()
    const reason = (name, error) => { if (!blocked.has(name)) { blocked.add(name); fail.push({ ...byName.get(name), error }) } }
    for (const item of entries) {
        for (const name of item.manifest.requires ?? []) if (!byName.has(name)) reason(item.name, `缺少依赖 ${name}`)
    }
    let changed = true
    while (changed) {
        changed = false
        for (const item of entries) {
            if (blocked.has(item.name)) continue
            for (const name of item.manifest.requires ?? []) if (blocked.has(name)) { reason(item.name, `缺少依赖 ${name}`); changed = true }
        }
    }
    const rest = entries.filter(item => !blocked.has(item.name))
    const degree = new Map(rest.map(item => [item.name, 0]))
    const edges = new Map(rest.map(item => [item.name, []]))
    const add = (from, to) => {
        if (!degree.has(to)) return
        edges.get(to).push(from)
        degree.set(from, degree.get(from) + 1)
    }
    for (const item of rest) {
        for (const name of item.manifest.requires ?? []) add(item.name, name)
        for (const name of item.manifest.after ?? []) add(item.name, name)
    }
    const ready = rest.map(item => item.name).filter(name => degree.get(name) === 0).sort()
    const ordered = []
    while (ready.length) {
        const name = ready.shift()
        ordered.push(byName.get(name))
        for (const next of (edges.get(name) ?? []).sort()) {
            degree.set(next, degree.get(next) - 1)
            if (degree.get(next) === 0) ready.push(next), ready.sort()
        }
    }
    for (const item of rest) if (!ordered.includes(item)) fail.push({ ...item, error: '循环依赖' })
    return { ordered, fail }
}

let context = { targets: {}, push() {}, tool() {}, untool() {} }

function hooks() {
    return { ...context, targets: { ...context.targets, Store, Extension } }
}

async function weave(entry) {
    if (await exists(join(entry.folder, 'backend.js'))) {
        const module = await import(`${entry.folder}/backend.js?t=${Date.now()}`)
        const ctx = Extension.scope(entry.name, hooks())
        await module.default(ctx)
    }
    const hasFrontend = await exists(join(entry.folder, 'frontend/index.js'))
    loaded.set(entry.name, { ...entry, frontend: hasFrontend ? `/api/extensions/${entry.name}/frontend.js` : undefined })
}

export const Loader = {
    BASE,
    hook(next) { context = { ...context, ...next } },
    roots() { return [join(root, 'extensions'), join(homedir(), '.agents', 'extensions')] },

    async scan(roots = Loader.roots()) {
        const found = []
        for (const dir of roots) found.push(...await scan(dir))
        const unique = new Map()
        for (const entry of found) unique.set(entry.name, entry)
        return [...unique.values()]
    },

    list() {
        return [...loaded.values()].map(({ name, version, error, frontend, manifest }) => ({ name, version, error, url: error ? undefined : frontend, description: manifest?.description }))
    },

    entries() { return Loader.list().filter(item => item.url) },

    inspect() { return { ...Extension.inspect(), loaded: Loader.list() } },

    async start(options = {}) {
        for (const name of [...loaded.keys()]) Loader.stop(name)
        const disabled = new Set(options.disabled ?? (await Store.config().catch(() => ({}))).extensions?.disabled ?? [])
        const found = []
        const skipped = []
        for (const entry of await Loader.scan(options.roots ?? Loader.roots())) {
            if (!compatible(entry.manifest)) skipped.push({ ...entry, error: `扩展协议 ${entry.manifest.base} 与基座 ${BASE} 不匹配` })
            else if (disabled.has(entry.name)) skipped.push({ ...entry, error: '已关闭' })
            else found.push(entry)
        }
        const { ordered, fail } = sort(found)
        for (const item of [...skipped, ...fail]) loaded.set(item.name, item)
        for (const entry of ordered) {
            try { await weave(entry) } catch (error) {
                Extension.revert(entry.name)
                loaded.set(entry.name, { ...entry, error: error.message ?? String(error) })
            }
        }
        return Loader.list()
    },

    stop(name) {
        const dependents = [...loaded.values()].filter(item => !item.error && (item.manifest?.requires ?? []).includes(name)).map(item => item.name)
        for (const one of dependents) Loader.stop(one)
        Extension.revert(name)
        Bundle.forget(name)
        const entry = loaded.get(name)
        if (entry && !entry.error) loaded.set(name, { ...entry, error: '已关闭', frontend: undefined })
    },

    async bundle(name) {
        const entry = loaded.get(name)
        if (!entry || entry.error || !entry.frontend) return null
        return Bundle.pack(name, entry.folder)
    },

    // 改关闭名单后整体重排再启动，好让依赖关系重新成立。
    async toggle(name, enabled) {
        const config = await Store.config()
        const disabled = new Set(config.extensions?.disabled ?? [])
        if (enabled) disabled.delete(name)
        else disabled.add(name)
        await Store.configure({ ...config, extensions: { ...config.extensions, disabled: [...disabled] } })
        return Loader.start()
    },

    // 测试里清掉全部已加载扩展，不改配置。
    reset() {
        for (const name of [...loaded.keys()]) {
            Extension.revert(name)
            Bundle.forget(name)
            loaded.delete(name)
        }
    },
}
