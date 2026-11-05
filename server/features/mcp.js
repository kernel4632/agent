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

// --- 连上的服务 ---
const connections = new Map()
// 连不上的服务记在这里（名字 → 失败原因）：本次进程内不再重试，避免每次装配会话都
// 卡在同一个起不来的服务上；但绝不改用户配置。配置是用户写的，临时故障不该变成永久停用。
const failures = new Map()

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

// --- 给一个异步操作加超时；结束后清掉定时器，不留悬挂的 timeout ---
const withTimeout = async (promise, ms, message) => {
    let timer
    try {
        return await Promise.race([
            promise,                                                                // 正常时以它为准
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) }),  // 到点就失败
        ])
    } finally {
        clearTimeout(timer)     // 正常结束时把定时器撤掉，不让它挂在那里
    }
}

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

// --- 连接一个服务并拉取工具清单 ---
// 用 withTimeout 包住“建客户端”和“拉工具”两步：外部 stdio 服务起不来或不应答时，
// 不能让整个会话装配卡在那里。失败只记进 failures 并在本次进程内跳过，
// 不改用户配置——临时故障不该变成永久停用，用户下次修好命令就该能重连。
const connect = async ({ name, sessionId }) => {
    const definition = (store.config.mcp || {})[name]     // 该服务在内存里的定义
    if (!definition) return null                          // 没配这个服务，什么都不做
    if (definition.enabled === false) return null         // 用户停用了，不连

    try {
        const client = await withTimeout(createMCPClient({ transport: transportFor(definition) }), 5000, `MCP 服务 ${name} 启动连接超时`)
        const tools = await withTimeout(client.tools(), 5000, `MCP 服务 ${name} 读取工具清单超时`)
        connections.set(name, { client, tools })          // 连上了就留着，下次装配直接复用
        failures.delete(name)                             // 之前失败过也算翻篇
        return tools
    } catch (error) {
        failures.set(name, error.message)                 // 记住这次失败，同一进程内不再重试
        // 一次连不上不该拖垮整个会话，告诉界面就好。
        if (sessionId) await SSE.send({ id: sessionId, data: { type: 'mcp-error', server: name, error: error.message } })
        return null
    }
}

// --- 配置改了以后丢掉旧连接，下次用到时按新定义重连 ---
const disconnect = async name => {
    failures.delete(name)          // 配置变了，之前的失败结论不再成立
    const connection = connections.get(name)
    if (!connection) return
    connections.delete(name)
    await connection.client.close().catch(() => {})
}

// --- 取全部已连服务的工具，需要时先连上新增加的服务 ---
const tools = async ({ sessionId } = {}) => {
    const configured = Object.keys(store.config.mcp || {})
    // 配置里已经删掉的服务，它们的连接、工具和失败记录都不该再留着。
    for (const name of [...connections.keys()]) {
        if (!configured.includes(name)) await disconnect(name)
    }
    for (const name of [...failures.keys()]) {
        if (!configured.includes(name)) failures.delete(name)
    }
    // 本次进程内失败过的先跳过：每次都重试只会让每轮对话都卡几秒。
    const pending = configured.filter(name => !connections.has(name) && !failures.has(name))
    await Promise.all(pending.map(name => connect({ name, sessionId })))

    const merged = {}
    for (const [name, connection] of connections) {
        for (const [toolName, tool] of Object.entries(connection.tools)) merged[`${name}_${toolName}`] = tool
    }
    return merged
}

// --- 设置页用的服务清单：只读内存配置，不主动连接 ---
// 带上去连接失败的原因（如果有）：用户看得到“这个服务现在起不来”，
// 而不是发现它被瞄悄悄关掉了。暂不自动改配置——临时故障不该变成永久停用。
const list = () => Object.entries(store.config.mcp || {})
    .map(([name, definition]) => ({
        name,
        enabled: definition.enabled !== false,
        definition,
        ...(failures.has(name) ? { error: failures.get(name) } : {}),
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
    failures.clear()
}

// --- 最近一次连接失败的原因；设置页用它提示“这个服务起不来” ---
const lastError = name => failures.get(name) || ''

export default { tools, connect, close, bind, list, save, remove, toggle, test, lastError }
