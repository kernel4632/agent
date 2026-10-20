/*
设置页登记表：设置导航和动态页面都从这里读取，新增或删除一个设置页只动这个文件。
每个页面登记 id、label、icon、group 和 component；禁用页写 disabled: true，并且不提供 component。
新增页面的步骤：先在 pages/ 下建一个接收 draft 的包装组件，再在 settingsPages 里加一项。
删除页面的步骤反过来：删掉登记项和对应包装文件；被其他页面复用的原设置组件不要动。
调用示例：<component :is="page.component" :draft="draft" />；导航用 groupSettingsPages(pages) 分组。
*/
import AppearancePage from './pages/AppearancePage.vue'
import ProvidersPage from './pages/ProvidersPage.vue'
import PromptsPage from './pages/PromptsPage.vue'
import AdvancedPage from './pages/AdvancedPage.vue'
import ToolsPage from './pages/ToolsPage.vue'
import MCPSPage from './pages/MCPSPage.vue'

export const settingsPages = [
  { id: 'appearance', label: '通用', icon: 'settings', group: '偏好', component: AppearancePage },
  { id: 'providers', label: '模型供应商', icon: 'globe', group: '服务', component: ProvidersPage },
  { id: 'prompts', label: '系统提示词', icon: 'document', group: '服务', component: PromptsPage },
  { id: 'advanced', label: '高级', icon: 'code', group: '服务', component: AdvancedPage },
  { id: 'tools', label: '工具管理', icon: 'code', group: '服务', component: ToolsPage },
  { id: 'mcp', label: 'MCP 服务', icon: 'link', group: '服务', component: MCPSPage },
  { id: 'data', label: '数据管理', icon: 'folder', group: '其他', disabled: true },
]

// 按登记顺序分组；新增页面落在哪个 group，导航就自动出现在对应分组下。
export function groupSettingsPages(pages = settingsPages) {
  const groups = []
  for (const page of pages) {
    let group = groups.find(item => item.label === page.group)
    if (!group) {
      group = { label: page.group, items: [] }
      groups.push(group)
    }
    group.items.push(page)
  }
  return groups
}
