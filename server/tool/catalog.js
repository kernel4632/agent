/*
 * 工具目录：扫描 tools/，登记每个工具自己声明的类别和文件参数，再给设置页列出权限。
 *
 * 加一个工具只往 tools/ 放一个文件，文件里写 name、kind、files；这里不维护任何中央名单。
 * MCP 工具要连上服务才知道名字，这里不连；它们统一由自动批准里的 `mcp` 类别管。
 * 调用示例：
 *   await Tools.register()  // 扫描并登记，会话启动前必须做一次
 *   await Tools.list()      // [{ name: 'read_file', kind: 'read', permission: 'ask' }, ...]
 */

import { mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import Path from '../utils/path.js'
import Store from '../state/store.js'
import Subtask from '../session/subtask.js' // new_task 的界面描述在运行时工具里。
import Kind from './kind.js'
import { registerToolFiles, resetToolFiles } from './files.js'
import { canonical, previousNames } from './names.js' // 旧 permission 配置继续生效。

const builtIn = () => fileURLToPath(new URL('../tools/', import.meta.url))

// 扫描到的工具元数据：catalog.js 列目录时直接读，不再为了拿名字和 ui 二次扫描工具。
const tools = new Map()

// --- 扫描一个目录里的工具模块，把工具自己声明的元数据登记到运行时表 ---
const registerDirectory = async directory => {
    for await (const file of new Bun.Glob('*.js').scan({ cwd: directory })) {
        try {
            const module = await import(pathToFileURL(join(directory, file)).href)
            const exported = Array.isArray(module.default) ? module.default : [module.default]
            for (const tool of exported) {
                // 工具文件是用户可写的边界；一个坏文件只跳过它自己，不拖垮整个会话。
                if (!tool?.name) throw new Error('tool file must export a tool with a name')
                tools.set(tool.name, { name: tool.name, kind: tool.kind || 'other', ui: tool.ui })
                Kind.register({ name: tool.name, kind: tool.kind || 'other' }) // 用户工具没写类别时按 other。
                registerToolFiles({ name: tool.name, files: tool.files })
            }
        } catch (error) {
            console.error(`[tools] 跳过 ${file}：${error.message}`)
        }
    }
}

// --- 扫描内置和用户工具；会话启动、设置页列目录前都先调用 ---
const register = async () => {
    // 每轮都从空表重新扫：删掉一个工具文件后，下一次列目录/开会话就不会再看到它。
    tools.clear()
    Kind.reset()
    resetToolFiles()
    // 这两件是运行时工具，没有文件可扫；类别在重建登记表后补回来。
    Kind.register({ name: 'new_task', kind: 'subtask' })
    Kind.register({ name: 'skill', kind: 'read' })

    await mkdir(Path.tools(), { recursive: true }) // 首次运行还没有用户工具目录。
    await registerDirectory(builtIn())
    await registerDirectory(Path.tools())
}

/**
 * 这个工具当前生效的权限动作。
 * 工具自己的规则优先；对象规则看默认项；都没写就跟随全局 `*`。
 * @param {string} name 工具名。
 * @returns {'allow'|'ask'|'deny'} 当前动作。
 */
const permissionOf = name => {
    const rules = Store.config.permission || {}
    const actionOf = value => value === 'allow' ? 'allow' : value === 'deny' ? 'deny' : 'ask' // 认不出的写法按“询问”显示
    // 新名字优先，旧名字兜底，改名不会让用户原来的 deny 规则失效。
    const rule = [canonical(name), ...previousNames(name)].map(item => rules[item]).find(item => item !== undefined)
    if (typeof rule === 'string') return actionOf(rule)
    if (rule && typeof rule === 'object' && !Array.isArray(rule)) return actionOf(rule['*'])
    return actionOf(rules['*'])
}

/**
 * 列出内置工具和用户工具。
 * ui 是工具脚本自己声明的展示信息，前端据此选择渲染器；没有声明时前端退回通用行。
 * configurable=false 的控制工具只给对话页用，不出现在权限设置里。
 * @returns {Promise<Array<{ name: string, kind: string, permission: string, configurable: boolean, ui?: object }>>} 按名字排序的工具目录。
 */
const list = async () => {
    await register()
    // 文件工具来自扫描结果；new_task 和 skill 是运行时工具，只在分类表里有名字。
    const names = new Set([...tools.keys(), ...Kind.registered().keys()])
    return [...names]
        .sort()
        .map(name => {
            const entry = tools.get(name)
            const ui = entry?.ui || (name === 'new_task' ? Subtask.ui : null)
            const kind = Kind.of({ toolName: name })                     // 分类只从工具自己的声明里取。
            const kindInfo = Kind.KINDS.find(item => item.kind === kind)  // 类别的用户可读名字也只从后端来。
            const oldNames = previousNames(name)                         // 旧会话里的工具名，前端据此找回新名字。
            return {
                name,
                kind,
                kindLabel: kindInfo?.label || kind,
                kindHint: kindInfo?.hint || '',
                permission: permissionOf(name),
                // 控制工具也要把 ui 交给对话页，但设置页不画它们的权限开关。
                configurable: kind !== 'never',
                ...(oldNames.length ? { previousNames: oldNames } : {}),
                ...(ui && typeof ui === 'object' && !Array.isArray(ui) ? { ui } : {}),
            }
        })
}

export default { register, list }
