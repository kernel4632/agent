/*
设置指令：负责隔离草稿、供应商、模型、工具、MCP 和离页自动保存。
保存时把页面字段转换回 Server 配置结构，成功后重新加载最终生效数据。
调用示例：Settings.open()、await Settings.save()、Settings.addProvider()。
*/
import { AgentAPI } from '../api.js'                    // 引入正式配置和能力 HTTP 契约
import { store } from '../store.js'                     // 引入已保存配置和设置反馈
import { Config } from './config.js'                    // 引入保存后的配置重新加载动作
import { UI } from './ui.js'                            // 引入保存错误轻反馈
import { t } from '../i18n.js'                          // 引入当前语言默认和反馈文案


// --- 深复制可持久化配置 ---
function clone(value) {
  return JSON.parse(JSON.stringify(value))              // 配置只包含 JSON 数据，可安全隔离草稿
}


// --- 进入设置页 ---
function open() {
  store.settings.draft = clone({
    providers: store.config.providers,                  // 供应商编辑使用页面适配结构
    tools: store.config.tools,                          // 工具权限使用运行目录
    mcp: store.config.mcp,                              // MCP 使用编辑与状态组合结构
    prompt: store.config.prompt,                        // 提示词使用独立字段
    appearance: store.config.appearance,                // 外观偏好只在前端持久化
  })
}


// --- 离开设置页并保存 ---
async function save() {
  const draft = store.settings.draft                    // 读取当前隔离草稿
  if (!draft || store.settings.isSaving) return false   // 尚未进入或已有保存时不重复提交
  store.settings.isSaving = true                        // 导航期间公开保存状态
  try {
    const providers = Object.fromEntries(Object.entries(draft.providers).map(([name, provider]) => {
      let headers = {}                                   // 无自定义头时保存空对象
      try { headers = typeof provider.headers === 'string' ? JSON.parse(provider.headers || '{}') : provider.headers || {} } // 将设置文本解析为 Server 对象
      catch { throw new Error(`${name} 自定义请求头不是有效 JSON`) } // 阻止损坏配置进入 Server
      const { enabled, timeout, ...saved } = provider    // 移除仅页面使用字段
      return [name, { ...saved, enabled, timeoutMs: timeout, headers }] // 恢复 Server 字段名称
    }))
    const permissions = Object.fromEntries(draft.tools.map((tool) => [tool.name, tool.permission])) // 工具选择转换为权限映射
    const mcpServers = Object.fromEntries(draft.mcp.map((server) => [server.name, { ...(server.definition || {}), enabled: server.enabled, command: server.definition?.command || server.command }])) // 保存完整 MCP 定义
    await AgentAPI.updateConfig({ providers, permissions, mcpServers, systemPrompt: draft.prompt }) // 一次性提交配置业务字段
    store.config.appearance = clone(draft.appearance)    // 外观设置在当前前端会话即时生效
    await Config.load()                                  // 重新读取脱敏最终配置和运行能力
    store.settings.savedAt = Date.now()                  // 设置页再次进入可展示保存时间
    store.settings.draft = null                          // 释放已经提交的编辑副本
    return true                                          // 反馈自动保存完成
  } catch (error) {
    UI.notify(error.message)                             // 展示 JSON 或 Server 保存错误
    return false                                         // 保留草稿供用户修正
  } finally {
    store.settings.isSaving = false                      // 保存终态恢复后续导航
  }
}


// --- 新增提供商 ---
function addProvider() {
  const draft = store.settings.draft                    // 读取当前设置草稿
  if (!draft) return ''                                  // 设置尚未加载时拒绝动作
  let number = Object.keys(draft.providers).length + 1  // 从现有数量生成可读名称
  let name = `Provider ${number}`                       // 创建首个候选名称
  while (draft.providers[name]) name = `Provider ${++number}` // 避免覆盖同名配置
  draft.providers[name] = { enabled: true, protocol: 'openai-compatible', baseURL: '', apiKey: '', models: [], modelSettings: {}, timeout: 120000, headers: '{}' } // 建立完整可编辑字段
  return name                                            // 页面立即选择新提供商
}


// --- 删除提供商 ---
function removeProvider(name) {
  const providers = store.settings.draft?.providers     // 读取提供商草稿
  if (!providers?.[name]) return false                  // 无目标保持页面不变
  delete providers[name]                                // 从待保存集合删除
  return true                                           // 页面选择剩余首项
}


// --- 重命名提供商 ---
function renameProvider(oldName, newName) {
  const providers = store.settings.draft?.providers     // 读取提供商草稿
  const cleanName = newName.trim()                      // 名称不保存首尾空白
  if (!providers?.[oldName] || !cleanName || (providers[cleanName] && cleanName !== oldName)) return false // 拒绝空值和冲突
  if (cleanName === oldName) return true                // 未变化视为保存成功
  const entries = Object.entries(providers).map(([name, value]) => [name === oldName ? cleanName : name, value]) // 保持列表原顺序
  store.settings.draft.providers = Object.fromEntries(entries) // 写回新键名集合
  return cleanName                                       // 页面保持新名称选中
}


// --- 修改提供商字段 ---
function updateProvider(name, field, value) {
  const provider = store.settings.draft?.providers?.[name] // 读取当前提供商草稿
  if (!provider) return false                           // 不存在的提供商不能修改
  provider[field] = value                               // 字段变化立即反馈详情面板
  return true                                           // 反馈修改完成
}


// --- 添加模型 ---
function addModel(providerName, modelName) {
  const provider = store.settings.draft?.providers?.[providerName] // 读取目标提供商
  const cleanName = modelName.trim()                   // 模型 ID 不保留空白
  if (!provider || !cleanName || provider.models.includes(cleanName)) return false // 拒绝无效和重复模型
  provider.models.push(cleanName)                       // 模型立即进入目录
  provider.modelSettings[cleanName] = { context: 128000, maxOutputTokens: 16000, reasoning: true, tools: true } // 创建完整默认能力
  return true                                           // 模型选择窗保持可继续添加
}


// --- 删除模型 ---
function removeModel(providerName, modelName) {
  const provider = store.settings.draft?.providers?.[providerName] // 读取目标提供商
  if (!provider) return false                           // 无目标保持页面不变
  provider.models = provider.models.filter((item) => item !== modelName) // 删除模型目录项
  delete provider.modelSettings[modelName]              // 同步删除能力设置
  return true                                           // 反馈删除完成
}


// --- 修改模型设置 ---
function updateModel(providerName, modelName, changes) {
  const provider = store.settings.draft?.providers?.[providerName] // 读取目标提供商
  if (!provider?.models.includes(modelName)) return false // 只修改目录中存在的模型
  provider.modelSettings[modelName] = { ...(provider.modelSettings[modelName] || {}), ...changes } // 合并模型能力与限制
  return true                                           // 设置弹窗即时反馈
}


// --- 获取可添加模型目录 ---
async function fetchModels(providerName) {
  const provider = store.settings.draft?.providers?.[providerName] // 读取目标供应商现有模型
  if (!provider) return []                                // 当前供应商被删除时不产生发现请求
  try {
    const result = await AgentAPI.listProviderModels(providerName) // 通过 Server 使用已保存认证读取真实目录
    return (result.models || []).filter((model) => !provider.models.includes(model)) // 只展示尚未添加的真实模型
  } catch (error) {
    UI.notify(error.message)                              // 发现失败原位反馈真实上游错误
    return []                                             // 失败时保持弹窗可关闭
  }
}


// --- 新增 MCP ---
function addMCP() {
  const mcp = store.settings.draft?.mcp                 // 读取 MCP 草稿
  if (!mcp) return null                                  // 设置未加载时保持页面
  const item = { id: `mcp-${crypto.randomUUID().slice(0, 8)}`, name: t('newMcp'), command: '', enabled: false, definition: { transport: 'stdio', args: [], env: {} } } // 建立完整 stdio 默认定义
  mcp.push(item)                                         // 新连接进入列表
  return item                                            // 页面可继续编辑新项
}


// --- 修改工具配置 ---
function updateTool(name, changes) {
  const tool = store.settings.draft?.tools.find((item) => item.name === name) // 查找工具配置
  if (!tool) return false                               // 不存在的工具保持列表
  Object.assign(tool, changes)                          // 启用、别名和权限使用同一动作
  return true                                           // 反馈修改完成
}


// --- 修改 MCP 配置 ---
function updateMCP(id, changes) {
  const item = store.settings.draft?.mcp.find((server) => server.id === id) // 查找目标 MCP
  if (!item) return false                               // 不存在的连接保持列表
  Object.assign(item, changes)                          // 开关、名称和命令立即写入草稿
  return true                                           // 反馈修改完成
}


// --- 删除 MCP ---
function removeMCP(id) {
  const mcp = store.settings.draft?.mcp                 // 读取 MCP 草稿
  if (!mcp) return false                                 // 无草稿保持页面
  const index = mcp.findIndex((item) => item.id === id) // 查找目标连接
  if (index < 0) return false                            // 已删除连接无需重复动作
  mcp.splice(index, 1)                                   // 从待保存配置删除
  return true                                           // 反馈动作完成
}


// --- 修改全局提示词 ---
function updatePrompt(value) {
  if (!store.settings.draft) return false                // 无草稿时拒绝修改
  store.settings.draft.prompt = value                    // 提示词变化立即反馈编辑器
  return true                                            // 反馈修改完成
}


// --- 修改外观字段 ---
function updateAppearance(field, value) {
  const appearance = store.settings.draft?.appearance   // 读取外观设置草稿
  if (!appearance || !['language', 'density', 'animations'].includes(field)) return false // 仅允许既定外观字段
  appearance[field] = value                              // 单字段变化进入隔离草稿
  return true                                            // 反馈修改完成
}


export const Settings = { open, save, addProvider, removeProvider, renameProvider, updateProvider, addModel, removeModel, updateModel, fetchModels, updateTool, addMCP, updateMCP, removeMCP, updatePrompt, updateAppearance } // 暴露设置全部动作
