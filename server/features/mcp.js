/*
 * MCP 服务：把配置里的外部工具服务连上，把它们的工具交给 Agent。
 *
 * 配置的 mcp 字段一个服务一项，键是服务名：
 *   {
 *     "mcp": {
 *       "everything": { "command": "bun", "args": ["server.js"] },
 *       "remote": { "transport": "sse", "url": "https://example.com/sse" }
 *     }
 *   }
 * 连上的服务给出工具名带服务名前缀，两个服务撞名时不会互相覆盖。
 * 调用示例：
 *   const tools = await Mcp.tools({ sessionId })
 *   await Mcp.close()
 */

import { createMCPClient } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport as Stdio } from '@ai-sdk/mcp/mcp-stdio'
import store from '../store.js'
import SSE from '../utils/sse.js'

// 连上是慢的（要起子进程、握手），所以连过一次就留着。
const connections = new Map()

// --- 连接一个 MCP 服务 ---
const connect = async ({ name, sessionId }) => {
    const definition = (store.config.mcp || {})[name]
    if (!definition) return null
    if (definition.enabled === false) return null

    try {
        const transport = definition.transport === 'sse' || definition.transport === 'http'
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

        const client = await createMCPClient({ transport })
        const tools = await client.tools()
        connections.set(name, { client, tools })
        return tools
    } catch (error) {
        // 一个服务连不上不该拖垮整个会话，记下来让用户知道就行。
        if (sessionId) await SSE.send({ id: sessionId, data: { type: 'mcp-error', server: name, error: error.message } })
        return null
    }
}

// --- 取全部已连服务的工具，需要时先连上新增加的服务 ---
const tools = async ({ sessionId } = {}) => {
    const configured = Object.keys(store.config.mcp || {})
    // 配置里已经删掉的服务，它们的连接和工具都不该再留着。
    for (const name of [...connections.keys()]) {
        if (!configured.includes(name)) {
            await connections.get(name).client.close().catch(() => {})
            connections.delete(name)
        }
    }
    await Promise.all(configured.filter(name => !connections.has(name)).map(name => connect({ name, sessionId })))

    const merged = {}
    for (const [name, connection] of connections) {
        for (const [toolName, tool] of Object.entries(connection.tools)) merged[`${name}_${toolName}`] = tool
    }
    return merged
}

// --- 断开全部服务 ---
const close = async () => {
    for (const { client } of connections.values()) {
        await client.close().catch(() => {})
    }
    connections.clear()
}

export default { tools, connect, close }
