/*
 * 工具登记：扫描 tools/，把每个工具自己声明的类别、展示信息和快照钩子收集起来。
 *
 * 加一个工具只往 tools/ 放一个文件，删掉就消失；这里没有第二份中央名单。
 * 用户自己的工具放在数据目录的 tools/，同名时覆盖内置工具。
 * 工具执行时由这里补上会话上下文：当前目录、会话编号和宿主注入的保存会话能力；
 * 子任务的审批也由这里一路传下去。tools/ 只能 import store.js 和 utils/，需要 features 的能力时一律从参数传入。
 *
 * 调用示例：
 *   const catalog = await Tool.list()                       // 设置页用
 *   const { tools } = await Tool.build({                   // 会话启动时装配
 *       sessionId,
 *       mcp: Mcp,                                  // 外部 MCP 服务由调用方传入
 *       onPermission: checkPermission,                        // 工具执行前的审批关口
 *       saveSession: () => History.save(sessionId),          // 工具改会话后落盘
 *   })
 *   // 返回 { tools, mcpRevision, release }；release 由 Agent 销毁时调用。
 *   await Tool.snapshot({ sessionId, toolCallId, toolName, input })
 */

import { mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import Agent from '@kernel4632/agent-core'
import store, { TOOL_KINDS } from '../store.js'
import Path from '../utils/path.js'
import * as File from '../tools/file.js'

// MCP 由调用方传入；技能由扩展注入；本文件不 import 别的 feature。

/*
 * 工具类别：工具文件自己写 kind，扫描时登记；
 * 没有写 kind 的工具按 other 处理，一律要问用户。
 */
const KINDS = TOOL_KINDS

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
    const actionOf = value => value === 'allow' ? 'allow' : value === 'deny' ? 'deny' : value === 'review' ? 'review' : 'ask'
    const rule = rules[name]
    if (typeof rule === 'string') return actionOf(rule)
    if (rule && typeof rule === 'object' && !Array.isArray(rule)) return actionOf(rule['*'])
    return actionOf(rules['*'])
}

// --- 给设置页列出全部工具；skill 由扩展注入，这里只列框架内置的 ---
const list = async () => {
    const { tools } = await scan()
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

// --- 这个工具属于哪一类；MCP 工具按配置里的服务名前缀认；skill 由扩展注册 ---
const kind = ({ toolName, mcpServers = [] }) => {
    if (mcpServers.some(name => toolName.startsWith(`${name}_`))) return 'mcp'
    return current.tools.get(toolName)?.kind || 'other'
}

// --- 给一个工具补上会话上下文和宿主注入的运行时能力 ---
const attach = (tool, sessionId, { saveSession }) => ({
    ...tool,
    execute: (input, options = {}) => tool.execute(input, {
        ...options,
        sessionId,                                                 // 工具自己不用知道会话从哪来
        cwd: store.sessions[sessionId]?.cwd || process.cwd(),      // 相对路径按这条会话的当前目录算
        saveSession,                                               // cwd 这类工具改了会话后调用它落盘
    }),
})

// --- 组装一条会话的工具表：主 Agent 使用全部工具；skill 由扩展 patch 这个函数注入 ---
// 外部 MCP 工具按配置版本租用；Agent 销毁时释放租约，最后一个 Agent 释放后才关连接。
const build = async ({ sessionId, onPermission, saveSession, mcp }) => {
    const session = store.sessions[sessionId]
    const lease = await mcp.acquire({ sessionId })
    try {
        const { tools: registered } = await scan()                  // 扫描内置工具和用户工具
        const catalog = new Map(registered)                         // 按名字索引，后面同名会覆盖

        // 外部服务给的工具也一起交给模型；名字已经带服务名前缀。
        for (const [name, tool] of Object.entries(lease.tools)) {
            catalog.set(name, { ...tool, name, kind: 'mcp' })
        }

        // 技能工具由扩展注入（如果加载了 extensions/skill 的话）

        const bound = [...catalog.values()].map(tool => attach(tool, sessionId, { saveSession })) // 每个工具都带上会话上下文
        const set = Agent.tool.adopt(bound)                         // 转成 agent-core 认识的工具表
        return { tools: set, mcpRevision: lease.revision, release: lease.release }
    } catch (error) {
        lease.release()
        throw error
    }
}

// --- 当前 MCP 配置版本；由调用方传入 mcp 对象调用 ---
const revision = mcp => mcp?.revision?.() || 0

// --- 工具真正执行之前：交给工具自己的快照钩子 ---
const snapshot = async call => {
    await ready()
    const tool = current.tools.get(call.toolName)
    return tool?.snapshot ? tool.snapshot(call) : []
}

// --- 文件回退和 diff 都由文件工具实现 ---
const entries = args => File.entries(args)
// --- 某一次工具调用改过的文件：随 tool-result 一起推给前端 ---
const paths = async ({ sessionId, toolCallId } = {}) => {
    if (!sessionId || !toolCallId) return []
    const list = await entries({ sessionId })
    const found = new Set()
    for (const entry of list) {
        if (entry.toolCallId !== toolCallId) continue
        for (const path of entry.paths) found.add(path)
    }
    return [...found]
}
// --- 恢复文件：带 toolCallId 退回这一次工具调用之前；带 keepMessages 退回某条消息之前 ---
// 两个都给时走 toolCallId 分支（restoreTool），不要混传。
const restore = args => args?.toolCallId ? File.restoreTool(args) : File.restoreMessage(args)
// --- 只丢掉这次工具调用的快照，不动文件 ---
const drop = args => File.dropTool(args)
const undo = args => File.undo(args)
// --- 清空撤销栈：新消息代表新的时间线 ---
const clear = args => File.clearUndo(args)
const diff = args => File.diff(args)
const remove = args => File.remove(args)

export default {
    KINDS,
    list,
    build,
    revision,
    ready,
    kind,
    snapshot,
    entries,
    paths,
    restore,
    drop,
    undo,
    clear,
    diff,
    remove,
}
