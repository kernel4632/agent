/* 扫描三个工具目录；文件导出后立即可用，不维护注册表。 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stat } from 'node:fs/promises'
import Path from './path.js'

const list = async workspacePath => {
    const tools = {}
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
    const tool = context.tools[name]
    if (!tool) throw new Error(`Tool not found: ${name}`)

    const { tools, ...toolContext } = context
    return tool.execute(input, toolContext)
}

export default { list, execute }
