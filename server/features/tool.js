/*
 * 工具登记：扫描 tools/，把每个工具自己声明的类别、展示信息和快照钩子收集起来。
 *
 * 加一个工具只往 tools/ 放一个文件，删掉就消失；这里没有第二份中央名单。
 * 用户自己的工具放在数据目录的 tools/，同名时覆盖内置工具。
 * 工具执行时由这里补上会话上下文：当前目录、会话编号，文件工具和 cwd 工具靠它工作。
 *
 * 调用示例：
 *   const catalog = await Tool.list()                       // 设置页用
 *   const tools = await Tool.build({ sessionId, agent })    // 会话启动时装配
 *   await Tool.snapshot({ sessionId, toolCallId, toolName, input })
 */

import { mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import Agent from '@kernel4632/agent-core'
import store from '../store.js'
import Path from '../utils/path.js'
import Mcp from './mcp.js'
import Delegation from '../tools/subagent.js'
import Skill from '../tools/skill.js'
import * as File from '../tools/file.js'

/*
 * 自动批准能分别开关的类别。工具文件自己写 kind，扫描时登记；
 * 没有写 kind 的工具按 other 处理，一律要问用户。
 */
const KINDS = [
    { kind: 'read', label: '读取', hint: '读文件、列目录、搜代码、抓网页' },
    { kind: 'write', label: '写入', hint: '改文件、打补丁' },
    { kind: 'command', label: '执行命令', hint: '跑命令' },
    { kind: 'mcp', label: '使用 MCP', hint: 'MCP 服务提供的工具' },
    { kind: 'subtask', label: '创建子任务', hint: '开一个子任务去干活' },
]

// 能改磁盘的类别：只读智能体把它们整个摘掉。
const WRITING = ['write', 'command']

const builtinDir = () => fileURLToPath(new URL('../tools/', import.meta.url))

// 扫描结果只保留最近一次，审批和设置页都从这份表里取。
let current = { tools: new Map() }

// --- 扫描一个目录，把工具对象放进表里 ---
const loadDirectory = async (directory, tools) => {
    await mkdir(directory, { recursive: true })
    for await (const file of new Bun.Glob('*.js').scan({ cwd: directory })) {
        try {
            const module = await import(pathToFileURL(join(directory, file)).href)
            for (const tool of [module.default].flat()) {
                if (!tool?.name || typeof tool.execute !== 'function') continue
                tools.set(tool.name, tool)
            }
        } catch (error) {
            // 工具文件是用户可写的边界；一个坏文件只跳过它自己，不拖垮整个会话。
            console.error(`[tools] 跳过 ${file}：${error.message}`)
        }
    }
}

// --- 扫描内置工具和用户工具 ---
const scan = async () => {
    const tools = new Map()
    await loadDirectory(builtinDir(), tools)
    await loadDirectory(Path.tools(), tools)
    current = { tools }
    return current
}

// --- 这个工具当前显示的权限动作 ---
const permissionOf = name => {
    const rules = store.config.permission || {}
    const actionOf = value => value === 'allow' ? 'allow' : value === 'deny' ? 'deny' : 'ask'
    const rule = rules[name]
    if (typeof rule === 'string') return actionOf(rule)
    if (rule && typeof rule === 'object' && !Array.isArray(rule)) return actionOf(rule['*'])
    return actionOf(rules['*'])
}

// --- 给设置页列出全部工具 ---
const list = async () => {
    const { tools } = await scan()
    const extra = new Map([
        ['new_task', { name: 'new_task', kind: 'subtask', ui: Delegation.ui }],
        ['skill', { name: 'skill', kind: 'read', ui: { view: 'skill', icon: 'book', title: '读取技能', summary: '{name}' } }],
    ])
    for (const [name, tool] of extra) if (!tools.has(name)) tools.set(name, tool)

    return [...tools.values()]
        .sort((first, second) => first.name.localeCompare(second.name))
        .map(tool => {
            const kind = tool.kind || 'other'
            const kindInfo = KINDS.find(item => item.kind === kind)
            return {
                name: tool.name,
                kind,
                kindLabel: kindInfo?.label || kind,
                kindHint: kindInfo?.hint || '',
                permission: permissionOf(tool.name),
                configurable: kind !== 'never',
                ...(tool.ui && typeof tool.ui === 'object' && !Array.isArray(tool.ui) ? { ui: tool.ui } : {}),
            }
        })
}

// --- 需要时先扫描一次；审批可能在任何会话启动之前被直接调用 ---
const ready = async () => {
    if (current.tools.size) return current
    return scan()
}

// --- 这个工具属于哪一类；MCP 工具按配置里的服务名前缀认 ---
const kindOf = ({ toolName, mcpServers = [] }) => {
    if (mcpServers.some(name => toolName.startsWith(`${name}_`))) return 'mcp'
    if (toolName === 'new_task') return 'subtask'
    if (toolName === 'skill') return 'read'
    return current.tools.get(toolName)?.kind || 'other'
}

// --- 给一个工具补上会话上下文 ---
const bind = (tool, sessionId) => ({
    ...tool,
    execute: (input, options = {}) => tool.execute(input, {
        ...options,
        sessionId,
        cwd: store.sessions[sessionId]?.cwd || process.cwd(),
    }),
})

// --- 组装一条会话的工具表 ---
const build = async ({ sessionId, agent, taskConfig }) => {
    const session = store.sessions[sessionId]
    const { tools: registered } = await scan()
    const catalog = new Map(registered)

    // 外部服务给的工具也一起交给模型；名字已经带服务名前缀。
    for (const [name, tool] of Object.entries(await Mcp.tools({ sessionId }))) {
        catalog.set(name, { ...tool, name, kind: 'mcp' })
    }

    // 技能不把正文塞进工具表，只给一个按需读正文的工具。
    const skill = await Skill.build({ cwd: session.cwd })
    if (skill) catalog.set(skill.name, skill)

    // 自定义智能体点名的工具才装；写错名字直接忽略，不让会话打不开。
    const wanted = Array.isArray(agent?.tools) ? new Set(agent.tools) : null
    let chosen = [...catalog.values()].filter(tool => !wanted || wanted.has(tool.name))

    /*
     * 只读智能体去掉能改磁盘的工具。先筛工具表、后装 new_task：
     * 子 agent 拿到的就是筛过的这张表，不能借子任务绕过"只看不做"。
     */
    if (agent?.readOnly) chosen = chosen.filter(tool => !WRITING.includes(tool.kind || 'other'))

    const bound = chosen.map(tool => bind(tool, sessionId))
    let set = Agent.tool.adopt(bound)

    const withTask = !wanted || wanted.has('new_task')
    if (withTask) {
        const task = Delegation.build({
            config: taskConfig,
            tools: set,
            sessionId,
        })
        set = Agent.tool.merge(set, Agent.tool.adopt({ new_task: task }))
    }
    return set
}

// --- 工具真正执行之前：交给工具自己的快照钩子 ---
const snapshot = async call => {
    await ready()
    const tool = current.tools.get(call.toolName)
    return tool?.snapshot ? tool.snapshot(call) : []
}

// --- 工具执行结束：命令类工具用它对比出改过的文件 ---
const end = async call => {
    await ready()
    const tool = current.tools.get(call.toolName)
    return tool?.end ? tool.end(call) : { skipped: true }
}

// --- 文件回退和 diff 都由文件工具实现 ---
const entries = args => File.entries(args)
const restoreTool = args => File.restoreTool(args)
const restoreMessage = args => File.restoreMessage(args)
const dropTool = args => File.dropTool(args)
const undo = args => File.undo(args)
const clearUndo = args => File.clearUndo(args)
const diff = args => File.diff(args)
const remove = args => File.remove(args)

export default {
    KINDS,
    list,
    build,
    bind,
    ready,
    kindOf,
    snapshot,
    end,
    entries,
    restoreTool,
    restoreMessage,
    dropTool,
    undo,
    clearUndo,
    diff,
    remove,
}
