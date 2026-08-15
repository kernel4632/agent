/* 内置与用户插件都是同一种工厂函数，目录中出现即可加载。 */
import { dirname, resolve } from 'node:path' // 定位内置插件目录。
import { fileURLToPath } from 'node:url' // 把当前模块 URL 转成本地路径。
import { stat } from 'node:fs/promises' // 校验目录并生成热加载版本号。
import Store from '../store.js' // 读取插件启停配置。
import Path from '../utils/path.js' // 定位用户插件目录。

const loaded = new Map() // 保存当前正在运行的插件实例。
let api = {} // 保存 server 注入的公开内核能力。
const setAPI = value => {
    api = value // 后续加载的插件都会收到同一 API。
}

const load = async name => {
    // 用户目录覆盖同名内置插件，禁用项会从运行态卸载。
    const found = new Map() // 用户目录后扫描，因此可覆盖同名内置插件。
    for (const root of [resolve(dirname(fileURLToPath(import.meta.url)), '../plugins'), Path.plugins()]) {
        if (!await stat(root).then(value => value.isDirectory()).catch(() => false)) continue // 跳过缺失目录。
        const pattern = name ? `${name}/index.js` : '*/index.js' // 支持单个重载或全量扫描。
        for await (const file of new Bun.Glob(pattern).scan({ cwd: root, absolute: true, onlyFiles: true })) {
            found.set(file.split('/').at(-2), file) // 用目录名作为插件名。
        }
    }
    if (name && !found.has(name)) await unload(name) // 文件删除后显式重载会立即卸载。
    if (!name) {
        for (const pluginName of loaded.keys()) {
            if (!found.has(pluginName) || Store.config.plugins[pluginName]?.enabled === false) {
                await unload(pluginName) // 全量扫描清理已删除或禁用实例。
            }
        }
    }

    for (const [pluginName, file] of found) {
        if (Store.config.plugins[pluginName]?.enabled === false) {
            await unload(pluginName) // 禁用配置优先于磁盘文件。
            continue // 不再创建该插件的新实例。
        }
        const previous = loaded.get(pluginName) // 热加载前先释放旧实例。
        if (previous) await unload(pluginName) // 防止定时器和连接重复存在。
        const factory = (await import(`${file}?v=${(await stat(file)).mtimeMs}`)).default
        const plugin = await factory(api) // 工厂使用公开 API 创建运行实例。
        loaded.set(pluginName, plugin) // 新实例立即参与工具和钩子查询。
        await plugin.hooks?.['plugin.load']?.({ plugin: pluginName })
    }
    return list() // 返回加载后的真实插件名列表。
}

const unload = async name => {
    const plugin = loaded.get(name) // 找到要释放的运行实例。
    if (!plugin) return false // 重复卸载不执行任何动作。
    await plugin.hooks?.['plugin.unload']?.({ plugin: name })
    await plugin.unload?.() // 关闭插件持有的连接、进程或定时器。
    loaded.delete(name) // 释放成功后才从运行表移除。
    return true // 告知调用方插件已经停止。
}

const list = () => [...loaded.keys()]
const tools = () => Object.fromEntries([...loaded.values()]
    .flatMap(plugin => Array.isArray(plugin.tools) ? plugin.tools : Object.values(plugin.tools || {}))
    .map(tool => [tool.name, tool]))
const emit = async (event, data) => {
    let value = data // 每个钩子的输出成为下一个钩子的输入。
    for (const plugin of loaded.values()) {
        value = await plugin.hooks?.[event]?.(value) ?? value
    }
    return value // 返回所有插件依次变换后的业务数据。
}

export default { load, unload, list, tools, emit, setAPI } // 暴露插件完整生命周期。
