/*
设置页登记表：设置首页的分组卡片和动态详情都从这里读取，新增或删除一个设置页只动这个文件。
每个页面登记 id、label、description、icon、group、tone 和 component；禁用页写 disabled: true，并且不提供 component。
description 是首页卡片里的一句话说明；tone 选图标底色，只取 primary、tertiary、secondary。
新增页面的步骤：先在 pages/ 下建一个接收 draft 的包装组件，再在 settingsPages 里加一项。
删除页面的步骤反过来：删掉登记项和对应包装文件；被其他页面复用的原设置组件不要动。
调用示例：<component :is="page.component" :draft="draft" />；首页用 groupSettingsPages(pages) 分组。
*/
import AppearancePage from './pages/AppearancePage.vue'
import ProvidersPage from './pages/ProvidersPage.vue'
import PromptsPage from './pages/PromptsPage.vue'
import AdvancedPage from './pages/AdvancedPage.vue'
import ToolsPage from './pages/ToolsPage.vue'
import MCPSPage from './pages/MCPSPage.vue'

export const settingsPages = [
  { id: 'appearance', label: '通用', description: '主题、强调色和界面偏好', icon: 'settings', group: '通用设置', tone: 'primary', component: AppearancePage },
  { id: 'providers', label: '模型供应商', description: '连接模型服务并管理可用模型', icon: 'globe', group: '模型与服务', tone: 'primary', component: ProvidersPage },
  { id: 'prompts', label: '系统提示词', description: '设置全局助手行为和回复风格', icon: 'document', group: '模型与服务', tone: 'tertiary', component: PromptsPage },
  { id: 'advanced', label: '高级', description: '诊断命令、规则读取和改动快照', icon: 'code', group: '模型与服务', tone: 'secondary', component: AdvancedPage },
  { id: 'tools', label: '工具管理', description: '查看工具权限并调整批准方式', icon: 'code', group: '模型与服务', tone: 'primary', component: ToolsPage },
  { id: 'mcp', label: 'MCP 服务', description: '连接外部工具和数据服务', icon: 'link', group: '模型与服务', tone: 'tertiary', component: MCPSPage },
  { id: 'data', label: '数据管理', description: '导出、备份和清理本地数据', icon: 'folder', group: '数据设置', tone: 'secondary', disabled: true },
]

// 按登记顺序分组；新增页面落在哪个 group，设置首页就自动出现对应卡片。
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
