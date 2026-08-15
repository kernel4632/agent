/* 扫描三个工具目录；文件导出后立即可用，不维护注册表。 */
import { dirname, resolve } from 'node:path' // 定位内置工具目录。
import { fileURLToPath } from 'node:url' // 将当前模块 URL 转为目录路径。
import { stat } from 'node:fs/promises' // 跳过尚未创建的自定义工具目录。
import Path from './path.js' // 定位全局和工作区工具目录。

const list = async workspacePath => {
    const tools = {} // 每次扫描都创建独立快照，避免跨会话串用。
    const builtIn = resolve(dirname(fileURLToPath(import.meta.url)), '../tools') // 内置工具始终最先发现。
    for (const directory of [builtIn, Path.tools(), Path.workspaceTools(workspacePath)]) {
        if (!await stat(directory).then(value => value.isDirectory()).catch(() => false)) continue // 目录可选。
        for await (const file of new Bun.Glob('*.js').scan({ cwd: directory, absolute: true, onlyFiles: true })) {
            const value = (await import(`${file}?v=${(await stat(file)).mtimeMs}`)).default // 修改文件后自动重载。
            for (const tool of Array.isArray(value) ? value : [value]) tools[tool.name] = tool // 同名后发现者覆盖前者。
        }
    }
    return tools // Context 把此快照交给本轮模型和执行器。
}
const execute = async (name, input, context) => {
    const tool = context.tools[name] // 只能执行模型看到的同一份工具快照。
    if (!tool) throw new Error(`Tool not found: ${name}`) // 避免执行另一工作区的同名工具。

    const { tools, ...toolContext } = context // 工具本身不需要扫描表。
    return tool.execute(input, toolContext) // 直接调用目录导出的业务对象。
}

export default { list, execute } // 暴露扫描和快照执行入口。
