/*
 * MCP 服务：把配置里的外部工具服务连上，把它们的工具交给 Agent；同时负责服务的增删改和连接测试。
 *
 * 配置的 mcp 字段一个服务一项，键是服务名：
 *   {
 *     "mcp": {
 *       "everything": { "command": "bun", "args": ["server.js"] },
 *       "remote": { "transport": "sse", "url": "https://example.com/sse" }
 *     }
 *   }
 * 连上的服务给出工具名带服务名前缀，两个服务撞名时不会互相覆盖。
 * 保存配置由 server.js 启动时绑定进来（本文件不 import 其他 feature）。
 *
 * 调用示例：
 *   const tools = await Mcp.tools({ sessionId })
 *   await Mcp.save({ name: 'everything', definition: { command: 'bun', args: ['server.js'] } })
 *   await Mcp.test({ name: 'everything' })
 *   await Mcp.close()
 */

import { createMCPClient } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport as Stdio } from '@ai-sdk/mcp/mcp-stdio'
import store from '../store.js'
import fail from '../utils/fail.js'
import SSE from '../utils/sse.js'

// 配置保存由命令层在启动时绑定；本文件不 import 别的 feature。
let services = {}
const bind = value => { services = value }

// 连上是慢的（要起子进程、握手），所以连过一次就留着。
const connections = new Map()

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

// --- 把一份定义换成传输层；stdio 每次新建，避免复用已关闭的进程 ---
const transportFor = definition => definition.transport === 'sse' || definition.transport === 'http'
    ? {
        type: definition.transport,
        url: definition.url || definition.command,
        headers: definition.headers,
    }
    : new Stdio({
        command: definition.command,
        args: definition.args || [],
        env: { ...process.env, ...(definition.env || {}) },
    })

// --- 连接一个 MCP 服务 ---
// --- 超时保护辅助函数：给异步任务附加超时，超时后立刻熔断抛错 ---
const withTimeout = (promise, ms, message) => Promise.race([
    promise, // 正常任务优先结算
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)), // 定时触发超时拒绝
])

// --- 连接一个服务并拉取工具清单 ---
const connect = async ({ name, sessionId }) => {
    const definition = (store.config.mcp || {})[name] // 获取该服务在内存中的配置定义
    if (!definition) return null // 未配置直接跳过
    if (definition.enabled === false) return null // 已停用直接跳过

    try {
        // 创建客户端与列出工具均设置 5 秒超时保护，防止异常 stdio 服务挂起拖死整个会话
        const client = await withTimeout(createMCPClient({ transport: transportFor(definition) }), 5000, `MCP 服务 ${name} 启动连接超时`)
        const tools = await withTimeout(client.tools(), 5000, `MCP 服务 ${name} 读取工具清单超时`)
        connections.set(name, { client, tools }) // 缓存已成功连接的客户端与工具
        return tools // 返回拉取到的工具字典
    } catch (error) {
        // 外部服务启动失败、异常或超时时，自动停用该服务并落盘，防止每次会话装配都重复卡死
        if (definition && definition.enabled !== false) {
            definition.enabled = false // 内存中将该故障服务标记为停用
            await services.config?.save().catch(() => {}) // 异步写回磁盘配置，保证后续开箱即过
        }
        // 一个服务连不上不该拖垮整个会话，记下来让用户知道就行。
        if (sessionId) await SSE.send({ id: sessionId, data: { type: 'mcp-error', server: name, error: error.message } })
        return null // 捕获超时或异常，保证外部流程正常往下走
    }
}

// --- 配置改了以后丢掉旧连接，下次用到时按新定义重连 ---
const disconnect = async name => {
    const connection = connections.get(name)
    if (!connection) return
    connections.delete(name)
    await connection.client.close().catch(() => {})
}

// --- 取全部已连服务的工具，需要时先连上新增加的服务 ---
const tools = async ({ sessionId } = {}) => {
    const configured = Object.keys(store.config.mcp || {})
    // 配置里已经删掉的服务，它们的连接和工具都不该再留着。
    for (const name of [...connections.keys()]) {
        if (!configured.includes(name)) await disconnect(name)
    }
    await Promise.all(configured.filter(name => !connections.has(name)).map(name => connect({ name, sessionId })))

    const merged = {}
    for (const [name, connection] of connections) {
        for (const [toolName, tool] of Object.entries(connection.tools)) merged[`${name}_${toolName}`] = tool
    }
    return merged
}

// --- 设置页用的服务清单：只读内存配置，不主动连接 ---
const list = () => Object.entries(store.config.mcp || {})
    .map(([name, definition]) => ({
        name,
        enabled: definition.enabled !== false,
        definition,
    }))
    .sort((first, second) => first.name.localeCompare(second.name))

const serverName = value => {
    const name = typeof value === 'string' ? value.trim() : ''
    if (!name) throw fail(400, 'mcp server name is required')
    if (name.length > 60) throw fail(400, 'mcp server name must be at most 60 characters')
    if (/[\u0000-\u001f]/.test(name)) throw fail(400, 'mcp server name cannot contain control characters')
    return name
}

// --- 只收当前形状：stdio 要命令，sse / http 要地址 ---
const normalize = value => {
    if (!isObject(value)) throw fail(400, 'mcp definition must be an object')
    const remote = typeof value.url === 'string' && value.url.trim()
    const transport = value.transport === 'sse' || value.transport === 'http'
        ? value.transport
        : (remote ? 'http' : 'stdio')
    const definition = { transport }

    if (transport === 'stdio') {
        if (typeof value.command !== 'string' || !value.command.trim()) throw fail(400, 'stdio mcp server needs a command')
        definition.command = value.command.trim()
        definition.args = Array.isArray(value.args) ? value.args.filter(item => typeof item === 'string') : []
        definition.env = isObject(value.env)
            ? Object.fromEntries(Object.entries(value.env).filter(([, item]) => typeof item === 'string'))
            : {}
    } else {
        if (typeof value.url !== 'string' || !value.url.trim()) throw fail(400, `${transport} mcp server needs a url`)
        definition.url = value.url.trim()
        if (isObject(value.headers)) {
            definition.headers = Object.fromEntries(Object.entries(value.headers).filter(([, item]) => typeof item === 'string'))
        }
    }

    definition.enabled = value.enabled !== false
    return definition
}

// --- 新增或整体替换一个服务 ---
const save = async ({ name, definition } = {}) => {
    const key = serverName(name)
    const value = normalize(definition)
    if (!isObject(store.config.mcp)) store.config.mcp = {}
    store.config.mcp[key] = value
    await services.config.save()
    await disconnect(key)
    return { name: key, enabled: value.enabled !== false, definition: value }
}

// --- 删除一个服务 ---
const remove = async ({ name } = {}) => {
    const key = serverName(name)
    if (!isObject(store.config.mcp) || !store.config.mcp[key]) throw fail(404, `MCP server not found: ${key}`)
    delete store.config.mcp[key]
    await services.config.save()
    await disconnect(key)
    return { ok: true, name: key }
}

// --- 启用或停用一个服务；停用后不再连接，也不出现在工具表里 ---
const toggle = async ({ name, enabled } = {}) => {
    const key = serverName(name)
    if (typeof enabled !== 'boolean') throw fail(400, 'enabled must be true or false')
    const current = isObject(store.config.mcp) ? store.config.mcp[key] : null
    if (!current) throw fail(404, `MCP server not found: ${key}`)
    current.enabled = enabled
    await services.config.save()
    await disconnect(key)
    return { name: key, enabled }
}

// --- 真实连一次并列出工具名，用来确认这套配置能不能用 ---
const test = async ({ name } = {}) => {
    const key = serverName(name) // 格式化清理服务名称
    const definition = isObject(store.config.mcp) ? store.config.mcp[key] : null // 读取服务定义
    if (!definition) throw fail(404, `MCP server not found: ${key}`) // 找不到返回 404

    let client = null // 待关闭的临时连接实例
    try {
        // 测试连接增加 8 秒超时保护，拉取工具列表增加 5 秒超时保护
        client = await withTimeout(createMCPClient({ transport: transportFor(definition) }), 8000, `连接测试超时（超过 8 秒未响应）`)
        const tools = await withTimeout(client.tools(), 5000, `获取工具清单超时（超过 5 秒未响应）`)
        return { ok: true, name: key, tools: Object.keys(tools).sort() } // 成功返回有序工具列表
    } catch (error) {
        return { ok: false, name: key, tools: [], error: error.message } // 失败返回具体超时或错误说明
    } finally {
        await client?.close().catch(() => {}) // 确保临时测试连接正常断开释放
    }
}

// --- 断开全部服务 ---
const close = async () => {
    for (const { client } of connections.values()) {
        await client.close().catch(() => {})
    }
    connections.clear()
}

export default { tools, connect, close, bind, list, save, remove, toggle, test }
