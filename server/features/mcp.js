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
 * commands/admin.js 在增删改之后接着调 Config.save()；本文件不 import 其他 feature。
 *
 * 调用示例：
 *   const lease = await Mcp.acquire({ sessionId })
 *   const tools = lease.tools
 *   lease.release()
 *   await Mcp.save({ name: 'everything', definition: { command: 'bun', args: ['server.js'] } })
 *   await Mcp.test({ name: 'everything' })
 *   await Mcp.close()
 */

import { createMCPClient } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport as Stdio } from '@ai-sdk/mcp/mcp-stdio'
import store from '../store.js'
import fail from '../utils/fail.js'
import SSE from '../utils/sse.js'

// 配置保存由调用方（commands/admin.js）负责；本文件只管 store.config.mcp 的内存状态和连接。

// 每次配置变化递增。Agent 记住自己创建时的版本，旧 Agent 不会被新配置从脚下改掉。
let revision = 0
const revisionOf = () => revision

// 连接按版本分组：旧 Agent 还在跑时，旧版本的连接不能被新配置关掉。
const connections = new Map()                        // `${revision}\0${name}` -> { client, tools }
const connecting = new Map()                         // `${revision}\0${name}` -> 正在进行的连接
const failures = new Map()                           // `${revision}\0${name}` -> 失败原因
const leases = new Map()                             // revision -> 持有它的 Agent 数量

const connectionKey = (name, rev = revision) => `${rev}\u0000${name}`

// 同一个定义握手成功后记住该走新协议还是旧协议，后续连接不必再撞一次。
const handshakes = new Map()
const definitionKey = definition => JSON.stringify(definition)

// --- 新协议探测失败会留下一个已经锁在 modern era 的连接；回退必须在全新的进程上做 ---
const protocolMismatch = error => {
    const text = [
        error?.code,
        error?.message,
        error?.cause?.message,
        typeof error?.data === 'string' ? error.data : '',
    ].join(' ')
    return /UNSUPPORTED_PROTOCOL_VERSION|initialize handshake|protocol version|server\/discover|2026-07-28|not accepted/i.test(text)
}

// --- 打开一条连接并读工具；建客户端和读清单都加超时，失败时关掉半开连接 ---
const openClient = async (definition, protocolVersionDiscovery, name) => {
    const client = await withTimeout(
        createMCPClient({ transport: transportFor(definition), protocolVersionDiscovery }),
        5000,
        `MCP 服务 ${name} 启动连接超时`,
    )
    try {
        const tools = await withTimeout(client.tools(), 5000, `MCP 服务 ${name} 读取工具清单超时`)
        return { client, tools }
    } catch (error) {
        await client.close().catch(() => {})
        throw error
    }
}

/**
 * 自动协商协议代际，用户不需要知道 initialize / server/discover。
 * 先按新协议探测；如果服务端已经锁到新协议却又拒绝回退，换一个全新连接走旧握手。
 * 成功的模式按定义缓存；定义变化后重新从新协议开始。
 */
const negotiate = async (definition, name) => {
    const key = definitionKey(definition)
    const preferred = handshakes.get(key)
    const modes = preferred === false ? [false, true] : [true, false]
    let firstProtocolError = null
    let lastError = null

    for (const discovery of modes) {
        try {
            const opened = await openClient(definition, discovery, name)
            handshakes.set(key, discovery)
            return opened
        } catch (error) {
            lastError = error
            if (!protocolMismatch(error)) throw error
            firstProtocolError ||= error
        }
    }

    throw new Error(`MCP 协议握手失败（已自动尝试新旧两种握手）：${firstProtocolError?.message || lastError?.message || lastError}`)
}

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
// 协议代际由 negotiate 自动处理；外部服务起不来时只记进当前版本的 failures 并在这版配置内跳过，
// 不改用户配置——临时故障不该变成永久停用，改配置后会重新尝试。
const connect = async ({ name, rev = revision, definition = (store.config.mcp || {})[name], sessionId }) => {
    if (!definition) return null                          // 没配这个服务，什么都不做
    if (definition.enabled === false) return null         // 用户停用了，不连

    const key = connectionKey(name, rev)
    const running = connecting.get(key)
    if (running) return running                           // 同一服务只连一次，后到的复用同一个结果

    const task = (async () => {
        try {
            const { client, tools } = await negotiate(definition, name)
            connections.set(key, { client, tools })           // 连上了就留着，同一版本的下次装配直接复用
            failures.delete(key)                              // 之前失败过也算翻篇
            return tools
        } catch (error) {
            failures.set(key, error.message)                  // 记住这次失败，同一版本内不再重试
            // 一次连不上不该拖垮整个会话，告诉界面就好。
            if (sessionId) await SSE.send({ id: sessionId, data: { type: 'mcp-error', server: name, error: error.message } })
            return null
        }
    })()
    connecting.set(key, task)
    try {
        return await task
    } finally {
        if (connecting.get(key) === task) connecting.delete(key)
    }
}

// --- 关闭一个版本的全部连接；只有没有 Agent 再持有这个版本时才调用 ---
const closeRevision = async rev => {
    // 先把失败记录和连接从索引里摘掉，避免关闭期间新 Agent 复用一半状态。
    for (const key of [...failures.keys()]) {
        if (key.startsWith(`${rev}\u0000`)) failures.delete(key)
    }
    const closing = []
    for (const [key, connection] of [...connections]) {
        if (!key.startsWith(`${rev}\u0000`)) continue
        connections.delete(key)
        closing.push(connection.client.close().catch(() => {}))
    }
    await Promise.all(closing)
}

// 配置版本前进后，没有任何 Agent 持有的旧版本可以立即回收。
const closeUnused = async () => {
    const revisions = new Set([
        ...leases.keys(),
        ...[...connections.keys()].map(key => Number(key.split('\u0000')[0])),
        ...[...failures.keys()].map(key => Number(key.split('\u0000')[0])),
    ])
    for (const rev of revisions) {
        if (rev !== revision && !leases.get(rev)) await closeRevision(rev)
    }
}

// --- 取某一版配置的全部工具；同版本内已经连上的直接复用 ---
const toolsForRevision = async (rev, sessionId) => {
    const configured = Object.keys(store.config.mcp || {})
    // 固定这一版的定义快照：连接期间用户改配置时，旧 Agent 不会拿到新旧混合的工具。
    const definitions = Object.fromEntries(configured.map(name => [name, store.config.mcp[name]]))
    // 同一版本里失败过的先跳过：每次都重试只会让每轮对话都卡几秒；换版本会重试。
    const pending = configured.filter(name => !connections.has(connectionKey(name, rev)) && !failures.has(connectionKey(name, rev)))
    await Promise.all(pending.map(name => connect({ name, rev, definition: definitions[name], sessionId })))

    const merged = {}
    for (const name of configured) {
        const connection = connections.get(connectionKey(name, rev))
        if (!connection) continue
        for (const [toolName, tool] of Object.entries(connection.tools)) merged[`${name}_${toolName}`] = tool
    }
    return merged
}

// --- 兼容只取工具的调用：测试和诊断用，不建立租约 ---
const tools = async ({ sessionId } = {}) => toolsForRevision(revision, sessionId)

// --- 服务启动时在后台把连接预热好；没有会话 id，所以不会往界面推连接失败提示 ---
const warm = () => toolsForRevision(revision)

/**
 * Agent 创建时拿一份工具租约；同一版本可以多个 Agent 共享连接。
 * Agent 销毁时 release，最后一个持有者释放后才关闭这一版连接。
 */
const acquire = async ({ sessionId } = {}) => {
    const rev = revision
    leases.set(rev, (leases.get(rev) || 0) + 1)
    try {
        const tools = await toolsForRevision(rev, sessionId)
        let released = false
        return {
            revision: rev,
            tools,
            release: () => {
                if (released) return
                released = true
                const count = Math.max(0, (leases.get(rev) || 1) - 1)
                if (count) leases.set(rev, count)
                else {
                    leases.delete(rev)
                    void closeRevision(rev)
                }
            },
        }
    } catch (error) {
        const count = Math.max(0, (leases.get(rev) || 1) - 1)
        if (count) leases.set(rev, count)
        else leases.delete(rev)
        throw error
    }
}

// 配置变了就前进一个版本；旧版本留给还在运行的 Agent，空闲旧 Agent 下次重建时回收。
const bump = async () => {
    revision += 1
    await closeUnused()
}

// --- 设置页用的服务清单：只读内存配置，不主动连接 ---
// 带上去连接失败的原因（如果有）：用户看得到“这个服务现在起不来”，
// 而不是发现它被瞄悄悄关掉了。暂不自动改配置——临时故障不该变成永久停用。
const list = () => Object.entries(store.config.mcp || {})
    .map(([name, definition]) => ({
        name,
        enabled: definition.enabled !== false,
        definition,
        ...(failures.has(connectionKey(name)) ? { error: failures.get(connectionKey(name)) } : {}),
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
    await bump()
    return { name: key, enabled: value.enabled !== false, definition: value }
}

// --- 删除一个服务 ---
const remove = async ({ name } = {}) => {
    const key = serverName(name)
    if (!isObject(store.config.mcp) || !store.config.mcp[key]) throw fail(404, `MCP server not found: ${key}`)
    delete store.config.mcp[key]
    await bump()
    return { ok: true, name: key }
}

// --- 启用或停用一个服务；停用后不再连接，也不出现在工具表里 ---
const toggle = async ({ name, enabled } = {}) => {
    const key = serverName(name)
    if (typeof enabled !== 'boolean') throw fail(400, 'enabled must be true or false')
    const current = isObject(store.config.mcp) ? store.config.mcp[key] : null
    if (!current) throw fail(404, `MCP server not found: ${key}`)
    current.enabled = enabled
    await bump()
    return { name: key, enabled }
}

// --- 真实连一次并列出工具名，用来确认这套配置能不能用 ---
const test = async ({ name } = {}) => {
    const key = serverName(name)
    const definition = isObject(store.config.mcp) ? store.config.mcp[key] : null
    if (!definition) throw fail(404, `MCP server not found: ${key}`)

    let client = null
    try {
        const opened = await negotiate(definition, key)
        client = opened.client
        return { ok: true, name: key, tools: Object.keys(opened.tools).sort() }
    } catch (error) {
        return { ok: false, name: key, tools: [], error: error.message }
    } finally {
        await client?.close().catch(() => {})
    }
}

// --- 断开全部服务 ---
const close = async () => {
    for (const { client } of connections.values()) {
        await client.close().catch(() => {})
    }
    connections.clear()
    connecting.clear()
    failures.clear()
    leases.clear()
    handshakes.clear()
}

// --- 最近一次连接失败的原因；设置页用它提示“这个服务起不来” ---
const error = name => failures.get(connectionKey(name)) || ''

export default { tools, warm, acquire, connect, close, list, save, remove, toggle, test, error, revision: revisionOf }
