/*
MCP：不进加号菜单，作为设置页「能力」组里的一个分类（#/settings/mcp，详情 #/settings/mcp/<名字>）。
*/
import { Plug01Icon } from '@hugeicons/core-free-icons'
import Panel from './Panel.vue'

export default app => {
    app.shell?.pages.add({ id: 'mcp', parent: 'settings', group: '能力', order: 30, tone: 'success', icon: Plug01Icon, title: 'MCP 服务', description: '连接外部工具和数据服务', component: Panel })
}
