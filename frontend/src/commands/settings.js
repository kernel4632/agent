/*
设置指令：负责隔离草稿、保存、模型发现和离页自动保存。
保存时把页面字段转换回 Server 配置结构，成功后重新加载最终生效数据。
调用示例：Settings.open()、await Settings.save()、Settings.discoverModels()。
*/
import { AgentAPI } from '../api.js'                    // 引入正式配置和能力 HTTP 契约
import { store } from '../store.js'                     // 引入已保存配置和设置反馈
import { Config } from './config.js'                    // 引入保存后的配置重新加载动作
import { UI } from './ui.js'                            // 引入保存错误轻反馈


// --- 隔离设置草稿数据 ---
function isolateDraft(value) {
  return JSON.parse(JSON.stringify(value))              // 设置只包含 JSON 数据，隔离后修改不影响已保存配置
}


// --- 进入设置页 ---
function open() {
  // 将 Server 存储结构转换为设置页可编辑的数组结构
  const providers = Object.entries(store.config.providers).map(([name, provider], index) => ({
    id: provider.id || `provider-${index + 1}`,         // 保留已有 ID，否则按顺序生成稳定身份
    name,                                                // 供应商键名即为编辑器显示名
    enabled: provider.enabled !== false,                 // 未明确关闭的供应商视为启用
    apiType: provider.protocol || 'openai-compatible',  // protocol 映射为前端选择器使用的 apiType 字段
    apiUrl: provider.baseURL || '',                      // Server 的 baseURL 对应编辑器中的请求地址
    apiKey: provider.apiKey || '',                       // 脱敏密钥原样保留，保存时 Server 会恢复真实值
    models: (provider.models || []).map(model => typeof model === 'string'
      ? { id: model, name: model, capabilities: ['文本', '工具'] }
      : { ...model, name: model.name || model.id, capabilities: model.capabilities || ['文本', '工具'] }),
  }))

  store.settings.draft = isolateDraft({
    providers,
    tools: store.config.tools,
    mcp: store.config.mcp,
    prompt: store.config.prompt,
    appearance: store.config.appearance,
  })
}


// --- 离开设置页并保存 ---
async function save() {
  const draft = store.settings.draft
  if (!draft || store.settings.isSaving) return false
  store.settings.isSaving = true
  try {
    const providers = (draft.providers || []).map(provider => ({
      name: provider.name,
      baseURL: provider.apiUrl || '',
      key: provider.apiKey || '',
      enabled: provider.enabled !== false,
      protocol: provider.apiType || 'openai-compatible',
      models: (provider.models || []).map(model => ({
        id: typeof model === 'string' ? model : model.id || model.name,
        contextWindow: typeof model === 'string' ? 128000 : model.contextWindow ?? model.context ?? 128000,
        maxOutput: typeof model === 'string' ? 16000 : model.maxOutput ?? model.maxOutputTokens ?? 16000,
      })),
    }))
    const permission = Object.fromEntries(
      (draft.tools || []).map(tool => [tool.name, tool.permission || (tool.enabled ? 'ask' : 'deny')])
    )
    const mcp = Object.fromEntries(
      (draft.mcp || []).map(item => [item.name, { ...item.definition, command: item.command, enabled: item.enabled }])
    )

    await AgentAPI.updateConfig({
      providers,
      prompts: { system: draft.prompt },
      permission,
      mcp,
    })
    store.config.appearance = isolateDraft(draft.appearance)
    persistAppearance(draft.appearance)
    await Config.load()
    store.settings.savedAt = Date.now()
    store.settings.draft = null
    return true
  } catch (error) {
    UI.notify(error.message)
    return false
  } finally {
    store.settings.isSaving = false
  }
}


// --- 外观偏好持久化到 localStorage ---
const appearanceKey = 'agent.appearance'

function persistAppearance(appearance) {
  try {
    localStorage.setItem(appearanceKey, JSON.stringify(appearance))
  } catch { /* localStorage 不可用时静默忽略 */ }
}


// --- 获取可添加模型目录 ---
async function fetchModels(provider, currentModels = []) {
  const baseURL = provider?.apiUrl?.trim().replace(/\/+$/, '')
  if (!baseURL) {
    UI.notify('请先填写请求地址（API）')
    return currentModels.map(model => ({ ...model }))
  }

  try {
    const response = await fetch(`/openai-proxy/models?baseURL=${encodeURIComponent(baseURL)}`, {
      headers: {
        accept: 'application/json',
        ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
      },
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error?.message || payload.error || `获取模型失败: ${response.status}`)

    const source = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : []
    const discovered = source
      .map(model => typeof model === 'string' ? model : model.id || model.name)
      .filter(Boolean)
      .map(id => ({ id, name: id, capabilities: ['文本', '工具'] }))
    if (!discovered.length) throw new Error('接口未返回可用模型')
    return discovered
  } catch (error) {
    UI.notify(error.message)
    return currentModels.map(model => ({ ...model }))
  }
}


async function replaceDraftAndSave(snapshot) {
  store.settings.draft = isolateDraft(snapshot)
  return save()
}


// --- 获取远程模型并与已有模型合并去重 ---
async function discoverModels(provider, currentModels = []) {
  const discovered = await fetchModels(provider, currentModels)
  const merged = new Map()
  for (const model of currentModels) merged.set(model.id, model)
  for (const model of discovered) merged.set(model.id, model)
  return [...merged.values()]
}


// --- 切换模型的添加/移除状态 ---
function toggleModelInList(models, model) {
  const exists = models.some(item => item.id === model.id)
  if (exists) return models.filter(item => item.id !== model.id)
  return [...models, { ...model }]
}


export const Settings = { open, save, replaceDraftAndSave, discoverModels, toggleModelInList }
