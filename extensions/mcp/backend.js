/*
MCP 管理：连接配置写在 config.mcp，形状跟 agent-core 的 MCPServer 一致。
改名单后同步到已经打开的 Agent；开关一条就调 agent.MCP.open / close。
*/

export default ctx => {
    const { Store, Agents } = ctx
    async function write(list) {
        const config = await Store.config()
        await Store.configure({ ...config, mcp: list })
        for (const current of Agents.all()) current.agent.MCP.list = list
        return list
    }
    ctx.op('mcp.list', async ({ id } = {}) => {
        const list = (await Store.config()).mcp ?? []
        const current = id ? Agents.peek(id) : undefined
        const clients = current?.agent?.['#internal'] ? null : current
        const states = {}
        if (current) {
            // 公开状态只在 MCPClients，宿主通常看不到；用 list 本身的 enabled，细节交给 open/close 的返回值。
            for (const server of current.agent.MCP.list) states[server.name] = { enabled: server.enabled !== false }
        }
        return { list, states }
    })
    ctx.op('mcp.save', async ({ mcp }) => write(Array.isArray(mcp) ? mcp : []))
    ctx.op('mcp.open', async ({ id, name }) => {
        const current = await Agents.open(id)
        const result = await current.agent.MCP.open(name)
        await write(current.agent.MCP.list)
        return result
    })
    ctx.op('mcp.close', async ({ id, name }) => {
        const current = await Agents.open(id)
        const result = await current.agent.MCP.close(name)
        await write(current.agent.MCP.list)
        return result
    })
    ctx.use('settings')?.add({
        id: 'mcp',
        title: 'MCP',
        fields: () => [{ key: 'mcp', type: 'json', label: 'MCP 连接列表（name / url / transport / headers / enabled）' }],
    })
}
