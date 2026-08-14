/* 扫描三个工具目录；文件导出后立即可用，不维护注册表。 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stat } from 'node:fs/promises'
import Path from './path.js'

const locks = new Map()
const registered = new Map()
const register = tool => registered.set(tool.name, tool)
const list = async workspacePath => {
    const tools = Object.fromEntries(registered)
    const builtIn = resolve(dirname(fileURLToPath(import.meta.url)), '../tools')
    for (const directory of [builtIn, Path.tools(), Path.workspaceTools(workspacePath)]) {
        if (!await stat(directory).then(value => value.isDirectory()).catch(() => false)) continue
        for await (const file of new Bun.Glob('*.js').scan({ cwd: directory, absolute: true, onlyFiles: true })) {
            const value = (await import(`${file}?v=${(await stat(file)).mtimeMs}`)).default
            for (const tool of Array.isArray(value) ? value : [value]) tools[tool.name] = tool
        }
    }
    return tools
}
const execute = async (name, input, context) => {
    const tool = context.tools?.[name]
    if (!tool) throw new Error(`Tool not found: ${name}`)
    const path = ['file_write', 'edit'].includes(name) ? resolve(input.path) : ''
    const previous = locks.get(path)?.catch(() => {}) || Promise.resolve()
    const current = previous.then(() => tool.execute(input, context))
    if (!path) return current
    const cleanup = current.finally(() => { if (locks.get(path) === cleanup) locks.delete(path) })
    cleanup.catch(() => {})
    locks.set(path, cleanup)
    return current
}

export default { list, register, execute }
