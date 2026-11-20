/*
扩展加载器：扫描项目里的 extensions/ 和 ~/.agents/extensions，按 manifest 的依赖排序后织入。
本阶段先提供扫描、列表和空启动；真正按依赖启停、打包前端入口，等扩展系统那一轮再补完。
启动失败的扩展会撤掉它已做的改动，不挡住开机。
*/

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dir, '../..')
const loaded = []

async function exists(path) {
    try { await stat(path); return true } catch { return false }
}

async function scan(dir) {
    if (!await exists(dir)) return []
    const entries = []
    for (const name of await readdir(dir)) {
        const folder = join(dir, name)
        const info = await stat(folder).catch(() => null)
        if (!info?.isDirectory()) continue
        const manifestPath = join(folder, 'manifest.json')
        if (!await exists(manifestPath)) continue
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
        entries.push({ name: manifest.name ?? name, version: manifest.version, manifest, folder })
    }
    return entries
}

export const Loader = {
    // 两处目录里声明了的扩展（尚未过滤依赖和协议版本）。
    async scan() {
        const home = join(homedir(), '.agents', 'extensions')
        const found = [...await scan(join(root, 'extensions')), ...await scan(home)]
        const unique = new Map()
        for (const entry of found) unique.set(entry.name, entry)
        return [...unique.values()]
    },

    list() {
        return loaded.map(({ name, error }) => ({ name, ...(error ? { error } : {}) }))
    },

    // 正在生效的扩展前端入口（已排好序）。本阶段还没有打包，返回空列表。
    entries() {
        return loaded.filter(item => !item.error && item.frontend).map(({ name, frontend }) => ({ name, url: frontend }))
    },

    async start() {
        loaded.length = 0
        const entries = await Loader.scan()
        for (const entry of entries) loaded.push({ name: entry.name, folder: entry.folder })
        return Loader.list()
    },
}
