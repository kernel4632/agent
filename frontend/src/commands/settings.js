/*
设置指令：负责设置草稿、提供商、模型、工具、MCP 和数据反馈。
设置页只编辑 draft；离开页面时一次性提交到全局 config。
调用示例：Settings.open()、Settings.addProvider()、Settings.save()。
*/
import { store } from '../store.js'                                  // 引入已保存配置和设置反馈
import { t } from '../i18n.js'                                       // 引入当前语言默认和反馈文案


// --- 深复制可持久化配置 ---
function clone(value) {
  return JSON.parse(JSON.stringify(value))                            // 配置只包含 JSON 数据，可安全隔离草稿
}


// --- 进入设置页 ---
function open() {
  store.settings.draft = clone(store.config)                          // 每次进入从已保存数据建立新草稿
  store.settings.feedback = ''                                       // 清除旧数据管理反馈
}


// --- 离开设置页并保存 ---
function save() {
  if (!store.settings.draft) return false                             // 尚未进入设置时无需保存

  // TODO(API): PATCH /config，提交 store.settings.draft；成功后使用 Server 配置覆盖 store.config。
  store.config = clone(store.settings.draft)                          // 本地阶段直接提交完整草稿
  store.settings.savedAt = Date.now()                                 // 设置页再次进入可展示保存时间
  store.settings.draft = null                                        // 释放离开页面后的编辑副本
  return true                                                         // 反馈自动保存完成
}


// --- 新增提供商 ---
function addProvider() {
  const draft = store.settings.draft                                  // 读取当前设置草稿
  if (!draft) return ''                                               // 设置尚未加载时拒绝动作
  let number = Object.keys(draft.providers).length + 1                // 从现有数量生成可读名称
  let name = `Provider ${number}`                                     // 创建首个候选名称
  while (draft.providers[name]) name = `Provider ${++number}`         // 避免覆盖同名配置
  draft.providers[name] = { enabled: true, baseURL: '', apiKey: '', models: [], modelSettings: {}, timeout: 120000, headers: '{}' } // 建立完整可编辑字段
  return name                                                         // 页面立即选择新提供商
}


// --- 删除提供商 ---
function removeProvider(name) {
  const providers = store.settings.draft?.providers                   // 读取提供商草稿
  if (!providers?.[name]) return false                                // 无目标保持页面不变
  delete providers[name]                                              // 从待保存集合删除
  return true                                                         // 页面选择剩余首项
}


// --- 重命名提供商 ---
function renameProvider(oldName, newName) {
  const providers = store.settings.draft?.providers                   // 读取提供商草稿
  const cleanName = newName.trim()                                    // 名称不保存首尾空白
  if (!providers?.[oldName] || !cleanName || (providers[cleanName] && cleanName !== oldName)) return false // 拒绝空值和冲突
  if (cleanName === oldName) return true                              // 未变化视为保存成功
  const entries = Object.entries(providers).map(([name, value]) => [name === oldName ? cleanName : name, value]) // 保持列表原顺序
  store.settings.draft.providers = Object.fromEntries(entries)        // 写回新键名集合
  return cleanName                                                     // 页面保持新名称选中
}


// --- 修改提供商字段 ---
function updateProvider(name, field, value) {
  const provider = store.settings.draft?.providers?.[name]           // 读取当前提供商草稿
  if (!provider) return false                                        // 不存在的提供商不能修改
  provider[field] = value                                            // 字段变化立即反馈详情面板
  return true                                                        // 反馈修改完成
}


// --- 添加模型 ---
function addModel(providerName, modelName) {
  const provider = store.settings.draft?.providers?.[providerName]    // 读取目标提供商
  const cleanName = modelName.trim()                                  // 模型 ID 不保留空白
  if (!provider || !cleanName || provider.models.includes(cleanName)) return false // 拒绝无效和重复模型
  provider.models.push(cleanName)                                     // 模型立即进入目录
  provider.modelSettings[cleanName] = { context: 128000, output: 16000, reasoning: true, tools: true } // 创建完整默认能力
  return true                                                          // 模型选择窗保持可继续添加
}


// --- 删除模型 ---
function removeModel(providerName, modelName) {
  const provider = store.settings.draft?.providers?.[providerName]    // 读取目标提供商
  if (!provider) return false                                         // 无目标保持页面不变
  provider.models = provider.models.filter((item) => item !== modelName) // 删除模型目录项
  delete provider.modelSettings[modelName]                            // 同步删除能力设置
  return true                                                          // 反馈删除完成
}


// --- 修改模型设置 ---
function updateModel(providerName, modelName, changes) {
  const provider = store.settings.draft?.providers?.[providerName]   // 读取目标提供商
  if (!provider?.models.includes(modelName)) return false            // 只修改目录中存在的模型
  provider.modelSettings[modelName] = { ...(provider.modelSettings[modelName] || {}), ...changes } // 合并模型能力与限制
  return true                                                        // 设置弹窗即时反馈
}


// --- 获取远程模型演示列表 ---
function fetchModels(providerName) {
  // TODO(API): 这里调用未来 Provider 模型发现接口；当前返回本地候选项供弹窗交互验证。
  const known = ['gpt-5-mini', 'gpt-4.1-mini', 'deepseek-r1', 'qwen3-32b'] // 提供未添加候选模型
  const current = store.settings.draft?.providers?.[providerName]?.models || [] // 读取现有目录
  return known.filter((model) => !current.includes(model))            // 弹窗只展示可新增项
}


// --- 新增 MCP ---
function addMCP() {
  const mcp = store.settings.draft?.mcp                               // 读取 MCP 草稿
  if (!mcp) return null                                               // 设置未加载时保持页面
  const item = { id: `mcp-${crypto.randomUUID().slice(0, 8)}`, name: t('newMcp'), command: '', enabled: false, status: 'stopped', toolCount: 0 }
  mcp.push(item)                                                       // 新连接进入列表
  return item                                                          // 页面可继续编辑新项
}


// --- 修改工具配置 ---
function updateTool(name, changes) {
  const tool = store.settings.draft?.tools.find((item) => item.name === name) // 查找工具配置
  if (!tool) return false                                             // 不存在的工具保持列表
  Object.assign(tool, changes)                                        // 启用、别名和权限使用同一动作
  return true                                                         // 反馈修改完成
}


// --- 修改 MCP 配置 ---
function updateMCP(id, changes) {
  const item = store.settings.draft?.mcp.find((server) => server.id === id) // 查找目标 MCP
  if (!item) return false                                             // 不存在的连接保持列表
  Object.assign(item, changes)                                        // 开关、名称和命令立即写入草稿
  item.status = item.enabled ? 'connected' : 'stopped'                // 本地演示同步运行反馈
  return true                                                         // 反馈修改完成
}


// --- 删除 MCP ---
function removeMCP(id) {
  const mcp = store.settings.draft?.mcp                               // 读取 MCP 草稿
  if (!mcp) return false                                               // 无草稿保持页面
  const index = mcp.findIndex((item) => item.id === id)               // 查找目标连接
  if (index < 0) return false                                         // 已删除连接无需重复动作
  mcp.splice(index, 1)                                                 // 从待保存配置删除
  return true                                                          // 反馈动作完成
}


// --- 数据管理反馈 ---
function dataAction(action) {
  // TODO(API): 根据 action 调用数据导出、导入或清理接口。
  const labels = { export: 'exportReady', import: 'chooseBackup', clear: 'demoNotCleared' } // 本地阶段使用明确反馈
  store.settings.feedback = labels[action] ? t(labels[action]) : ''   // 设置页原位展示结果
}


export const Settings = { open, save, addProvider, removeProvider, renameProvider, updateProvider, addModel, removeModel, updateModel, fetchModels, updateTool, addMCP, updateMCP, removeMCP, dataAction } // 暴露设置动作
