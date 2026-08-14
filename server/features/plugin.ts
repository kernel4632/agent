/*
全局插件宿主：扫描内置与用户插件，注册其工具，并在固定位置执行显式 hook。
插件只收到公开 Kernel API，不依赖内核文件路径或内部变量。
*/
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stat } from 'node:fs/promises'
import Path from '../utils/path.ts'
import Store from '../store.ts'
import type { AgentTool, HookName, PluginModule } from '../types.ts'
import Config from '../commands/config.ts'

const loaded = new Map<string, PluginModule>()
let api: Record<string, unknown> = {}

const setAPI = (kernelAPI: Record<string, unknown>) => {
    api = kernelAPI
}

const load = async (name?: string) => {
    if (!Object.keys(api).length) throw new Error('Plugin API is not configured')
    const files: string[] = []
    const builtIn = resolve(dirname(fileURLToPath(import.meta.url)), '../plugins')
    for (const directory of [builtIn, Path.plugins()]) {
        if (!await stat(directory).then(value => value.isDirectory()).catch(() => false)) continue
        const glob = new Bun.Glob('*/index.{js,ts}')
        for await (const file of glob.scan({ cwd: directory, absolute: true, onlyFiles: true })) {
            if (!name || file.split('/').at(-2) === name) files.push(file)
        }
    }
    if (name && !files.length) throw new Error(`Plugin not found: ${name}`)
    for (const path of files) {
        const discoveredName = path.split('/').at(-2)!
        if (loaded.has(discoveredName)) await unload(discoveredName)
        const create = (await import(path)).default as (api: Record<string, unknown>) => PluginModule | Promise<PluginModule>
        const plugin = await create(api)
        if (loaded.has(plugin.name)) {
            await unload(plugin.name)
        }
        try {
            await plugin.hooks?.['plugin.load']?.({ plugin: plugin.name })
            loaded.set(plugin.name, plugin)
        } catch (error) {
            await Promise.resolve(plugin.unload?.()).catch(() => undefined)
            throw error
        }
    }
    return list()
}

const unload = async (name: string) => {
    const plugin = loaded.get(name)
    if (!plugin) return false
    loaded.delete(name)
    const results = await Promise.allSettled([
        plugin.hooks?.['plugin.unload']?.({ plugin: name }),
        plugin.unload?.(),
    ])
    const failed = results.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
    return true
}

const list = () => [...loaded.keys()]
const tools = () => Object.fromEntries([...loaded.values()].flatMap(plugin => plugin.tools ?? []).map(tool => [tool.name, tool]))

const setEnabled = async (name: string, enabled: boolean) => {
    if (enabled) await load(name)
    else await unload(name)
    await Config.save({ plugins: { ...Store.config.plugins, [name]: { ...Store.config.plugins[name], enabled } } })
    return true
}

const emit = async (name: HookName, data: any) => {
    let current = data
    for (const plugin of loaded.values()) current = await plugin.hooks?.[name]?.(current) ?? current
    return current
}

const reset = async () => {
    await Promise.allSettled(list().map(unload))
}

export default { setAPI, load, unload, setEnabled, list, tools, emit, reset }
