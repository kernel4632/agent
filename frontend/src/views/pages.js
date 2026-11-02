/*
设置页登记表：设置首页的分组卡片和一级详情都从这里读取。
每个页面登记 id、label、description、icon、group、tone 和 component；禁用页写 disabled: true，并且不提供 component。
nested: true 的页面自己管理二级编辑页（供应商、智能体、工具、MCP）；SettingsView 只负责把 detail 和返回事件传下去。
description 是首页卡片里的一句话说明；tone 选图标底色，只取 primary、tertiary、secondary。
新增面板：在 components/ 下建立接 draft 的可见区域，在 settingsPages 中登记；面板直接使用草稿，不增加转发页面。
删除页面：删掉登记项和对应页面文件；被其他页面复用的原设置组件不要动。
调用示例：<component :is="page.component" :draft="draft" />；首页用 groupSettingsPages(pages) 分组。
*/
import AppearanceSettings from '../components/AppearanceSettings.vue'
import AgentSettings from '../components/AgentSettings.vue'
import ContextSettings from '../components/ContextSettings.vue'
import ModelSettings from '../components/ModelSettings.vue'
import ProviderList from '../components/ProviderList.vue'
import PromptSettings from '../components/PromptSettings.vue'
import AdvancedSettings from '../components/AdvancedSettings.vue'
import ToolsSettings from '../components/ToolsSettings.vue'
import MCPList from '../components/MCPList.vue'

export const settingsPages = [
  { id: 'appearance', label: '通用', description: '主题、强调色和界面偏好', icon: 'settings', group: '通用设置', tone: 'primary', component: AppearanceSettings },
  { id: 'providers', label: '模型供应商', description: '连接模型服务并管理可用模型', icon: 'globe', group: '模型与服务', tone: 'primary', component: ProviderList, nested: true },
  { id: 'model', label: '模型', description: '默认模型、模型能力和任务分工', icon: 'spark', group: '模型与服务', tone: 'primary', component: ModelSettings },
  { id: 'context', label: '上下文', description: '自动压缩阈值和历史整理', icon: 'stats', group: '模型与服务', tone: 'tertiary', component: ContextSettings },
  { id: 'agents', label: '智能体', description: '配置角色、提示词、模型、工具和权限', icon: 'mode', group: '模型与服务', tone: 'primary', component: AgentSettings, nested: true },
  { id: 'prompts', label: '系统提示词', description: '设置全局助手行为和回复风格', icon: 'document', group: '模型与服务', tone: 'tertiary', component: PromptSettings },
  { id: 'advanced', label: '高级', description: '诊断命令、规则读取和改动快照', icon: 'code', group: '模型与服务', tone: 'secondary', component: AdvancedSettings },
  { id: 'tools', label: '工具管理', description: '查看工具权限并调整批准方式', icon: 'code', group: '模型与服务', tone: 'primary', component: ToolsSettings, nested: true },
  { id: 'mcp', label: 'MCP 服务', description: '连接外部工具和数据服务', icon: 'link', group: '模型与服务', tone: 'tertiary', component: MCPList, nested: true },
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
