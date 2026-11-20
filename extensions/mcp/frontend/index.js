import Panel from './Panel.vue'

export default app => {
    app.shell?.pages.add({ id: 'mcp', title: 'MCP', parent: 'settings', component: Panel })
}
