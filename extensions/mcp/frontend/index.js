import Panel from './Panel.vue'
export default app => {
    app.panels.add({ id: 'mcp', title: 'MCP', component: Panel })
    app.plus.add({ id: 'mcp', label: 'MCP 连接', run: () => app.shared.openPanel?.('mcp') })
}
