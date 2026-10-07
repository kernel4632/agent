/*
 * MCP 服务：把用户在设置里配的外部工具服务连上，把它们的工具交给 Agent。
 *
 * MCP 服务的配置写在配置文件的 mcp 字段里，一个服务一项，键是服务名：
 *   {
 *     "mcp": {
 *       "everything": { "command": "bun", "args": ["server.js"] }
 *     }
 *   }
  * 连上的服务给出一批工具（工具名是 服务名_原名），和内置工具一起交给模型。
  * 调用示例：
  *   const tools = await Mcp.tools()   // 全部已连服务的工具，拼进 Agent.tool.from(...)
  *   await Mcp.close()                 // 断开全部服务；测试里用它收尾，进程退出时子进程会自己结束
  */
import { createMCPClient } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport as Stdio } from '@ai-sdk/mcp/mcp-stdio'
import SSE from '../utils/sse.js' // 连不上时告诉用户是哪个服务出了问题。
import Store from '../store.js' // 配置就在 Store 里，这里直接读它，不去问配置指令。

/*
 * 一个服务在内存里的样子：
 *   { client, tools }
 * 连上是慢的（要起子进程、握手），所以连过一次就留着，不每次建 Agent 都重连一遍。
 */
const connections = new Map()

// --- 连接一个 MCP 服务 ---
const connect = async name => {
    const definition = (Store.config.mcp || {})[name]
    // 配置里没有这个服务，说明用户在设置里删掉了，不用连。
    if (!definition) return null
    if (definition.enabled === false) return null // 用户先禁用了，等打开再连。

    try {
        const client = await createMCPClient({
            transport: new Stdio({
                command: definition.command,
                args: definition.args || [],
                // 服务自己的环境变量写在配置里，方便带 API Key 之类的凭据。
                env: { ...process.env, ...(definition.env || {}) },
            }),
        })
        const tools = await client.tools()
        connections.set(name, { client, tools })
        return tools
    } catch (error) {
        // 一个服务连不上不该拖垮整个会话，记下来让用户知道就行。
        await SSE.send({ id: 'mcp', data: { type: 'mcp-error', server: name, error: error.message } })
        return null
    }
}
/**
 * 取全部已连服务的工具，需要时先连上新增加的服务。
 * 配置里已经删掉的服务会在这里断开连接并收回它的工具。
 * @returns {Promise<object>} 工具名到工具对象的映射，名字带服务名前缀。
 */
const tools = async () => {
    const configured = Object.keys(Store.config.mcp || {})
    // 配置里已经删掉的服务，它们的连接和工具都不该再留着。
    for (const name of [...connections.keys()]) {
        if (!configured.includes(name)) {
            await connections.get(name).client.close().catch(() => {})
            connections.delete(name)
        }
    }
    // 配置里新增的服务在这里连上；已经连过的直接用。
    await Promise.all(configured.filter(name => !connections.has(name)).map(connect))

    // 拼成 agent-core 认识的一份工具表；服务名放在工具名前，避免两个服务撞名。
    const merged = {}
    for (const [name, connection] of connections) {
        for (const [toolName, tool] of Object.entries(connection.tools)) merged[`${name}_${toolName}`] = tool
    }
    return merged
}

// --- 断开全部服务 ---
const close = async () => {
    for (const { client } of connections.values()) {
        // 关不掉的服务不该挡住整个退出流程。
        await client.close().catch(() => {})
    }
    connections.clear()
}

export default { tools, connect, close }
