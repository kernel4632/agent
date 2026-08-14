import Store from '../store.ts'
import type { AgentTool, HookName, PluginModule } from '../types.ts'
import Config from '../commands/config.ts'
import File from './plugin-file.ts'

const loaded = new Map<string, PluginModule>()
let api: Record<string, unknown> = {}
let mutation = Promise.resolve()
const exclusive = <T>(action: () => Promise<T>) => {
    const result = mutation.then(action, action)
    mutation = result.then(() => undefined, () => undefined)
    return result
}

const setAPI = (kernelAPI: Record<string, unknown>) => {
    api = kernelAPI
}
const dispose = async (plugin: PluginModule) => {
    let failure: unknown
    try { await plugin.hooks?.['plugin.unload']?.({ plugin: plugin.name }) } catch (error) { failure = error }
    try { await plugin.unload?.() } catch (error) { failure ??= error }
    if (failure) throw failure
}

const loadNow = async (name?: string) => {
    if (!Object.keys(api).length) throw new Error('Plugin API is not configured')
    for (const path of await File.list(name)) {
        const discoveredName = path.split('/').at(-2)!
        const plugin = await File.create(path, api)
        if (plugin.name !== discoveredName) throw new Error(`Plugin name must match its directory: ${discoveredName}`)
        try {
            if (plugin.tools) plugin.tools = plugin.tools.map(tool => ({ ...tool, source: path, factory: true, hosted: File.hosted(path) || undefined }))
            await plugin.hooks?.['plugin.load']?.({ plugin: plugin.name })
            const previous = loaded.get(plugin.name)
            if (previous) await dispose(previous)
            loaded.set(plugin.name, plugin)
        } catch (error) {
            await dispose(plugin).catch(() => undefined)
            throw error
        }
    }
    return list()
}

const unloadNow = async (name: string) => {
    const plugin = loaded.get(name)
    if (!plugin) return false
    await dispose(plugin)
    loaded.delete(name)
    return true
}

const load = (name?: string) => exclusive(() => loadNow(name))
const unload = (name: string) => exclusive(() => unloadNow(name))

const list = () => [...loaded.keys()]
const tools = () => Object.fromEntries([...loaded.values()].flatMap(plugin => plugin.tools ?? []).map(tool => [tool.name, tool]))

const setEnabled = async (name: string, enabled: boolean) => {
    return exclusive(async () => {
        const previous = Store.config.plugins[name] ?? { enabled: false }
        await Config.save({ plugins: { ...Store.config.plugins, [name]: { ...previous, enabled } } })
        try {
            if (enabled) await loadNow(name)
            else await unloadNow(name)
            return true
        } catch (error) {
            await Config.save({ plugins: { ...Store.config.plugins, [name]: previous } })
            throw error
        }
    })
}

const emit = async (name: HookName, data: any) => {
    let current = data
    for (const plugin of loaded.values()) current = await plugin.hooks?.[name]?.(current) ?? current
    return current
}

const call = async (path: string, args: unknown[]) => {
    const names = path.split('.')
    const owner = names.slice(0, -1).reduce((value: any, name) => value?.[name], api as any)
    const method = owner?.[names.at(-1)!]
    if (typeof method !== 'function') throw new Error(`Plugin API method not found: ${path}`)
    return method(...args)
}

const reset = (timeout = 5_000) => exclusive(async () => {
    await Promise.race([Promise.allSettled(list().map(unloadNow)), Bun.sleep(timeout)])
    loaded.clear()
})

export default { setAPI, load, unload, setEnabled, list, tools, emit, call, reset }
