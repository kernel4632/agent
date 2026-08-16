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
import { normalizeAppearance } from '../theme.js'


// --- 隔离设置草稿数据 ---
function isolateDraft(value) {
  return JSON.parse(JSON.stringify(value))              // 设置只包含 JSON 数据，隔离后修改不影响已保存配置
}


// --- 进入设置页 ---
function open() {
  // 将 Server 存储结构转换为设置页可编辑的数组结构
  const providers = Object.entries(store.config.providers).map(([name, provider], index) => ({
    id: provider.id || `provider-${index + 1}`,           // 保留已有 ID，否则按顺序生成稳定身份
    name,                                                  // 供应商键名即为编辑器显示名
    enabled: provider.enabled !== false,                   // 未明确关闭的供应商视为启用
    apiType: provider.protocol || 'openai-compatible',     // protocol 映射为前端选择器使用的 apiType 字段
    apiUrl: provider.baseURL || '',                        // Server 的 baseURL 对应编辑器中的请求地址
    apiKey: provider.apiKey || '',                         // 脱敏密钥原样保留，保存时 Server 会恢复真实值
    models: (provider.models || []).map(model => typeof model === 'string'
      ? { id: model, name: model, capabilities: ['文本', '工具'] } // 字符串模型升级为包含默认能力的对象结构
      : model),                                            // 已经是对象结构的模型保持不变
  }))

  store.settings.draft = isolateDraft({
    providers,                                            // 转换为复制组件使用的数组结构
    tools: store.config.tools,                            // 工具权限使用运行目录
    mcp: store.config.mcp,                                // MCP 使用编辑与状态组合结构
    prompt: store.config.prompt,                          // 提示词使用独立字段
    appearance: store.config.appearance,                  // 外观偏好只在前端持久化
  })
}


// --- 离开设置页并保存 ---
async function save() {
  const draft = store.settings.draft                    // 读取当前隔离草稿
  if (!draft || store.settings.isSaving) return false   // 尚未进入或已有保存时不重复提交
  store.settings.isSaving = true                        // 导航期间公开保存状态
  try {
    const provider = draft.providers[0] || { apiUrl: '', apiKey: '', models: [] } // 当前最小 Server 只支持一个供应商

    // 将工具数组转换回 Server 的 permission 对象结构：{ toolName: "allow" | "ask" | "deny" }
    const permission = Object.fromEntries(
      (draft.tools || []).map(tool => [tool.name, tool.permission || (tool.enabled ? 'ask' : 'deny')])
    )

    // 将 MCP 数组转换回 Server 的 mcp 对象结构：{ name: definition }
    const mcp = Object.fromEntries(
      (draft.mcp || []).map(item => [item.name, { ...item.definition, command: item.command, enabled: item.enabled }])
    )

    await AgentAPI.updateConfig({
      provider: { api: provider.apiUrl || '', key: provider.apiKey || '', models: provider.models.map(model => model.id) }, // 供应商连接信息
      prompts: { system: draft.prompt },                 // 系统提示词
      permission,                                        // 工具权限配置
      mcp,                                               // MCP 服务定义
    })
    store.config.appearance = isolateDraft(draft.appearance)    // 外观设置在当前前端会话即时生效
    persistAppearance(draft.appearance)                         // 外观偏好写入 localStorage 跨刷新保留
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


// --- 外观偏好持久化到 localStorage ---
const appearanceKey = 'agent.appearance'                  // 浏览器持久化键名

function persistAppearance(appearance) {
  try {
    localStorage.setItem(appearanceKey, JSON.stringify(appearance)) // 序列化写入
  } catch { /* localStorage 不可用时静默忽略 */ }
}

function restoreAppearance() {
  try {
    const saved = JSON.parse(localStorage.getItem(appearanceKey))   // 读取上次保存的外观偏好
    if (saved && typeof saved === 'object') return saved            // 返回有效对象
  } catch { /* 损坏数据回退默认 */ }
  return normalizeAppearance() // 首次使用的默认值
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
async function fetchModels(provider, currentModels = []) {
  const baseURL = provider?.apiUrl?.trim().replace(/\/+$/, '') // OpenAI 兼容地址统一移除末尾斜杠，避免双斜杠 404
  if (!baseURL) {
    UI.notify('请先填写请求地址（API）')
    return currentModels.map(model => ({ ...model }))           // 无地址时返回现有模型副本保持列表不变
  }

  try {
    const response = await fetch(`/openai-proxy/models?baseURL=${encodeURIComponent(baseURL)}`, {
      headers: {
        accept: 'application/json',
        ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}), // 有密钥时附加认证头
      },
    })
    const payload = await response.json().catch(() => ({}))     // 解析失败时降级为空对象，不中断后续逻辑
    if (!response.ok) throw new Error(payload.error?.message || payload.error || `获取模型失败: ${response.status}`)

    // 兼容 OpenAI（payload.data）和其他供应商（payload.models）两种返回格式
    const source = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : []
    const discovered = source
      .map(model => typeof model === 'string' ? model : model.id || model.name) // 统一提取模型 ID 字符串
      .filter(Boolean)                                          // 过滤无效空值
      .map(id => ({ id, name: id, capabilities: ['文本', '工具'] })) // 所有远程模型默认具备文本和工具能力，后续用户可在设置中调整
    if (!discovered.length) throw new Error('接口未返回可用模型')
    return discovered                                           // 返回完整模型对象数组供选择弹窗使用
  } catch (error) {
    UI.notify(error.message)                                    // 展示真实网络或格式错误
    return currentModels.map(model => ({ ...model }))           // 失败时保持现有列表不变
  }
}


async function replaceDraftAndSave(snapshot) {
  store.settings.draft = isolateDraft(snapshot)                  // 接收复制设置页离开时提交的完整快照
  return save()                                           // 使用同一正式保存边界持久化
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
  if (!appearance || !(field in normalizeAppearance())) return false    // 只接受 ThemeElement 公开的外观字段
  appearance[field] = value                              // 单字段变化进入隔离草稿
  return true                                            // 反馈修改完成
}


// --- 获取远程模型并与已有模型合并去重 ---
async function discoverModels(provider, currentModels = []) {
  const discovered = await fetchModels(provider, currentModels) // 从远程获取模型列表
  const merged = new Map()                                      // 使用 Map 按 ID 去重
  for (const model of currentModels) merged.set(model.id, model) // 已有模型优先保留
  for (const model of discovered) merged.set(model.id, model)   // 新发现模型补充进来
  return [...merged.values()]                                   // 返回去重后的完整列表
}


// --- 切换模型的添加/移除状态 ---
function toggleModelInList(models, model) {
  const exists = models.some(item => item.id === model.id)      // 判断模型是否已在列表中
  if (exists) return models.filter(item => item.id !== model.id) // 已存在则移除
  return [...models, { ...model }]                               // 不存在则追加
}


export const Settings = { open, save, replaceDraftAndSave, addProvider, removeProvider, renameProvider, updateProvider, addModel, removeModel, updateModel, fetchModels, discoverModels, toggleModelInList, updateTool, addMCP, updateMCP, removeMCP, updatePrompt, updateAppearance } // 暴露设置全部动作
