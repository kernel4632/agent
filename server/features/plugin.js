/* 内置与用户插件都是同一种工厂函数，目录中出现即可加载。 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stat } from 'node:fs/promises'
import Store from '../store.js'
import Path from '../utils/path.js'

const loaded = new Map()
let api = {}
const setAPI = value => {
    api = value
}

const load = async name => {
    // 用户目录覆盖同名内置插件，禁用项会从运行态卸载。
    const found = new Map()
    for (const root of [resolve(dirname(fileURLToPath(import.meta.url)), '../plugins'), Path.plugins()]) {
        if (!await stat(root).then(value => value.isDirectory()).catch(() => false)) continue
        const pattern = name ? `${name}/index.js` : '*/index.js'
        for await (const file of new Bun.Glob(pattern).scan({ cwd: root, absolute: true, onlyFiles: true })) {
            found.set(file.split('/').at(-2), file)
        }
    }
    if (!name) {
        for (const pluginName of loaded.keys()) {
            if (!found.has(pluginName) || Store.config.plugins[pluginName]?.enabled === false) {
                await unload(pluginName)
            }
        }
    }

    for (const [pluginName, file] of found) {
        if (Store.config.plugins[pluginName]?.enabled === false) {
            await unload(pluginName)
            continue
        }
        const previous = loaded.get(pluginName)
        if (previous) await unload(pluginName)
        const factory = (await import(`${file}?v=${(await stat(file)).mtimeMs}`)).default
        const plugin = await factory(api)
        loaded.set(pluginName, plugin)
        await plugin.hooks?.['plugin.load']?.({ plugin: pluginName })
    }
    return list()
}

const unload = async name => {
    const plugin = loaded.get(name)
    if (!plugin) return false
    await plugin.hooks?.['plugin.unload']?.({ plugin: name })
    await plugin.unload?.()
    loaded.delete(name)
    return true
}

const list = () => [...loaded.keys()]
const tools = () => Object.fromEntries([...loaded.values()]
    .flatMap(plugin => Array.isArray(plugin.tools) ? plugin.tools : Object.values(plugin.tools || {}))
    .map(tool => [tool.name, tool]))
const emit = async (event, data) => {
    let value = data
    for (const plugin of loaded.values()) {
        value = await plugin.hooks?.[event]?.(value) ?? value
    }
    return value
}

export default { load, unload, list, tools, emit, setAPI }
