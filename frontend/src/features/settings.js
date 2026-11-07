/*
 * 设置：全局配置、供应商参数、草稿和外观偏好。
 *
 * 配置只在设置页修改；供应商字段映射和连接测试也在这里，避免两处各转一套。
 * 外观只写浏览器偏好，不碰服务端配置；设置保存后由调用方刷新会话列表。
 *
 * 调用示例：
 *   await Settings.load()
 *   Settings.open()
 *   await Settings.autoSave()
 *   Provider.discoverModels(provider, models)
 */

import { AgentAPI } from '../utils/api.js'
import { store } from '../store.js'
import { Notice } from '../utils/notice.js'
import { Appearance } from '../utils/appearance.js'
import { DEFAULT_CONTEXT } from '../defaults.js'

// --- 加载完整设置数据 ---
async function load() {
  try {
    // 这些接口属于同一版后端，缺任何一个都说明连接不对；不再为旧后端逐项兜底。
    const [raw, catalog, kinds, meta] = await Promise.all([
      AgentAPI.getConfig(),                              // 当前持久化配置
      AgentAPI.getTools(),                               // 全部工具和当前权限
      AgentAPI.getToolKinds(),                           // 工具类别的名字和顺序
      AgentAPI.getConfigMeta(),                          // “按用途配模型”的标签和说明
    ])
    apply(raw, catalog, kinds, meta)                     // 将 Server 数据转换为设置页面结构
    store.ui.errorMessage = ''
    return true                                           // 反馈应用启动可以继续
  } catch (error) {
    store.ui.errorMessage = error.message                 // 页面展示真实连接或协议错误
    return false                                          // 不制造假配置
  }
}

// --- 工具权限只从当前后端的完整工具目录读取 ---
function toolSettingsFor(catalog) {
  const tools = catalog
      .filter(tool => tool.configurable !== false)
      .map(tool => ({
        name: tool.name,
        title: tool.ui?.title || tool.name,
        kind: tool.kind,
        kindLabel: tool.kindLabel || tool.kind,
        kindHint: tool.kindHint || '',
        permission: tool.permission,
        original: tool.permission,
        // 工具脚本声明的渲染信息；设置页保存时不会把它写回 permission。
        ui: tool.ui && typeof tool.ui === 'object' && !Array.isArray(tool.ui) ? tool.ui : null,
      }))
  return { toolCatalog: catalog, tools }
}

// --- MCP 服务：对象转成设置页的数组，传输方式与后端的默认判断一致 ---
function mcpList(raw) {
  return Object.entries(raw.mcp ?? {}).map(([name, definition]) => {
    const normalized = structuredClone(definition || {})
    // URL 默认走 SSE，本地命令默认走 stdio。
    if (!normalized.transport) normalized.transport = normalized.url ? 'sse' : 'stdio'
    return {
      id: name,
      name,
      command: normalized.command || normalized.url || '',
      enabled: normalized.enabled !== false,
      definition: normalized,
    }
  })
}

// --- 默认模型：优先用户选过的那组，供应商或模型被删掉时退回第一个可用模型 ---
function modelChoice(providers, raw) {
  const firstProvider = Object.keys(providers).find(key => providers[key].enabled && providers[key].models.length) || ''
  const firstModel = providers[firstProvider]?.models[0]?.id || ''
  const preferred = raw.models.chat
  const preferredModels = preferred ? providers[preferred.provider]?.models || [] : []
  const valid = providers[preferred.provider]?.enabled && preferredModels.some(model => model.id === preferred.model)
  return {
    activeProvider: valid ? preferred.provider : firstProvider,
    activeModel: valid ? preferred.model : firstModel,
  }
}

// --- 应用 Server 配置到设置结构 ---
function apply(raw, catalog = [], catalogKinds = [], meta = { models: [] }) {
  const providers = providerMap(raw)
  const { toolCatalog, tools } = toolSettingsFor(catalog)
  const { activeProvider, activeModel } = modelChoice(providers, raw)

  Object.assign(store.config, {
    providers,
    tools,
    toolCatalog,
    kindOptions: Array.isArray(catalogKinds) ? catalogKinds : [],
    modelTasks: meta.models,
    models: raw.models,
    compact: raw.compact,
    mcp: mcpList(raw),
    prompt: raw.prompt?.system || '',
    appearance: store.config.appearance,
    activeProvider,
    activeModel,
    raw: structuredClone(raw),
  })
}

let initialBackendDraft = ''

// --- 后端配置里由设置页负责的字段 ---
function backendSnapshot(draft) {
  return JSON.stringify({
    providers: draft.providers,
    prompt: draft.prompt,
    models: draft.models,
    compact: draft.compact,
    mcp: draft.mcp,
    // original 只用来判断“这一项改过没有”，不是后端字段。
    tools: (draft.tools || []).map(({ original, ...tool }) => tool),
    allowAll: draft.allowAll === true,
  })
  // appearance 只存浏览器本地；切换主题不应该额外写一次后端配置。
}

// --- 导入 MCP 后只刷新服务列表，保留其他正在编辑的草稿字段 ---
async function refreshMcp() {
  try {
    const raw = await AgentAPI.getConfig()
    const items = mcpList(raw)
    store.config.raw = structuredClone(raw)
    store.config.mcp = items
    if (store.settings.draft) {
      const current = new Map((store.settings.draft.mcp || []).map(item => [item.id, item]))
      store.settings.draft.mcp = items.map(item => current.get(item.id) || item)
    }
    return items
  } catch (error) {
    Notice.show(error.message)
    return null
  }
}

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
    apiKey: provider.apiKey || '',                       // 密钥只保存在草稿内存和后端配置
    stream: provider.stream,                             // 流式开关属于供应商连接
    headers: jsonText(provider.headers) || '{}',         // 自定义请求头以 JSON 文本编辑
    body: jsonText(provider.body) || '{}',               // 额外请求体以 JSON 文本编辑
    models: provider.models,
  }))

  store.settings.draft = isolateDraft({
    providers,
    tools: store.config.tools,
    mcp: store.config.mcp,
    prompt: store.config.prompt,
    models: store.config.models,
    compact: store.config.compact,
    appearance: store.config.appearance,
    allowAll: (store.config.raw?.permission || {})['*'] === 'allow',
  })
  initialBackendDraft = backendSnapshot(store.settings.draft)
}

// --- 保存设置：关闭时保存整份，输入变化时自动保存但保留草稿 ---
let lastAutoSaveError = ''

let persistQueue = Promise.resolve()

function persist(options = {}) {
  const result = persistQueue.then(() => doPersist(options))
  persistQueue = result.then(() => undefined, () => undefined)
  return result
}

// --- 工具开关写回 permission；只写用户真的改过的那几个，对象规则里的参数模式保留 ---
function permissionPayload(draft) {
  const permission = { ...(store.config.raw?.permission || {}) }
  for (const tool of draft.tools || []) {
    if (tool.original !== undefined && tool.permission === tool.original) continue
    const current = permission[tool.name]
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      permission[tool.name] = { ...current, '*': tool.permission }
    } else {
      permission[tool.name] = tool.permission
    }
  }
  // 全部批准只动全局 *。不改写每个工具已经记住的允许或拒绝，避免开关来回拨把规则清掉。
  // 工具默认仍是 ask 时，由审批层用全局 allow 盖过去，多行命令也不会再弹窗。
  const savedAllowAll = (store.config.raw?.permission || {})['*'] === 'allow'
  if (draft.allowAll === true && !savedAllowAll) permission['*'] = 'allow'
  else if (draft.allowAll === false && savedAllowAll) permission['*'] = 'ask'
  return permission
}

// --- MCP 数组转回后端认的对象：键是服务名；远程服务存 url，本地服务存 command ---
function mcpPayload(draft) {
  const mcp = {}
  for (const item of draft.mcp || []) {
    const definition = { ...(item.definition || {}) }
    if (definition.transport === 'sse' || definition.transport === 'http') {
      definition.url = item.command || ''
      delete definition.command
    } else {
      definition.command = item.command || ''
      delete definition.url
    }
    definition.enabled = item.enabled !== false
    mcp[(item.name || '').trim()] = definition
  }
  return mcp
}

// --- 整份设置按当前后端形状提交；不发送已经移除的配置项 ---
function configPayload(draft) {
  return {
    providers: providerPayload(draft),
    mcp: mcpPayload(draft),
    permission: permissionPayload(draft),
    prompt: { ...store.config.raw?.prompt, system: draft.prompt },
    models: draft.models,
    compact: draft.compact,
  }
}

async function doPersist({ keepDraft = false, silent = false } = {}) {
  const draft = store.settings.draft
  if (!draft) return false
  store.settings.isSaving = true
  try {
    if (backendSnapshot(draft) === initialBackendDraft) {
      store.config.appearance = isolateDraft(draft.appearance)
      Appearance.save(draft.appearance)
      store.settings.savedAt = Date.now()
      lastAutoSaveError = ''
      if (!keepDraft) store.settings.draft = null
      return true
    }
    const names = (draft.providers || []).map(provider => provider.name.trim())
    if (names.some(name => !name) || new Set(names).size !== names.length) throw new Error('供应商名称不能为空或重复')
    const mcpNames = (draft.mcp || []).map(item => (item.name || '').trim())
    if (mcpNames.some(name => !name) || new Set(mcpNames).size !== mcpNames.length) throw new Error('MCP 服务名称不能为空或重复')
    await AgentAPI.updateConfig(configPayload(draft))
    store.config.appearance = isolateDraft(draft.appearance)
    Appearance.save(draft.appearance)
    if (!await load()) throw new Error('设置已发送，但重新读取失败。请重试连接以确认保存状态。')
    // 保存成功后，草稿里的“已保存值”跟着前进，改回旧值也要写回后端。
    for (const tool of draft.tools || []) tool.original = tool.permission
    store.settings.savedAt = Date.now()
    initialBackendDraft = backendSnapshot(draft)
    lastAutoSaveError = ''
    if (!keepDraft) store.settings.draft = null
    return true
  } catch (error) {
    if (!silent || lastAutoSaveError !== error.message) Notice.show(error.message)
    lastAutoSaveError = error.message
    return false
  } finally {
    store.settings.isSaving = false
  }
}

async function save({ keepDraft = false } = {}) {
  return persist({ keepDraft }) // 页面退出动画结束前仍需要同一份草稿渲染内容
}

// 输入变化时调用：成功后保留草稿和当前焦点，不重建正在编辑的页面。
async function autoSave() {
  return persist({ keepDraft: true, silent: true })
}

async function replaceDraftAndSave(snapshot) {
  store.settings.draft = isolateDraft(snapshot)
  return save()
}

export const Settings = { load, apply, open, save, autoSave, replaceDraftAndSave, refreshMcp }

// 添加与编辑共用这份协议目录；仅列出当前后端支持的连接类型。
export const PROVIDER_TYPES = [
  { value: 'openai-compatible', label: 'OpenAI 兼容', hint: 'OpenAI、DeepSeek 和兼容服务', url: 'https://api.openai.com/v1' },
  { value: 'responses', label: 'OpenAI Responses', hint: '使用 Responses 接口的服务', url: 'https://api.openai.com/v1' },
  { value: 'anthropic', label: 'Anthropic', hint: 'Claude 和兼容服务', url: 'https://api.anthropic.com/v1' },
  { value: 'gemini', label: 'Google Gemini', hint: 'Google Gemini 原生接口', url: 'https://generativelanguage.googleapis.com/v1beta' },
]

/** 选定接口类型后创建编辑草稿；名称不与已有供应商重复。 */
function createDraft(type, providers) {
  const option = PROVIDER_TYPES.find(item => item.value === type)
  let name = option.label
  for (let number = 2; providers.some(provider => provider.name === name); number++) name = `${option.label} ${number}`
  return { id: crypto.randomUUID(), name, enabled: true, apiType: type, apiUrl: option.url, apiKey: '', stream: true, headers: '{}', body: '{}', models: [] }
}

/** 后端供应商按名称索引；模型对象完整保留，名称、上下文和能力不再拆成第二张表。 */
function providerMap(raw) {
  return Object.fromEntries(raw.providers.map(provider => [provider.name, provider]))
}

/** 用服务端已保存的供应商和模型发起真实连接测试。 */
async function testConnection(providerName, modelName) {
  try {
    return await AgentAPI.testProvider(providerName, modelName) // 使用 Server 已保存认证执行真实测试
  } catch (error) {
    return { ok: false, provider: providerName, model: modelName, error: error.message } // 返回结构化失败反馈
  }
}

/** 将请求头、额外请求体显示为可以编辑的 JSON 文本。 */
function jsonText(value) {
  if (!value) return ''
  let object = value
  if (typeof value === 'string') {
    try { object = JSON.parse(value) } catch { return value }
  }
  if (!object || typeof object !== 'object' || Array.isArray(object) || !Object.keys(object).length) return ''
  return JSON.stringify(object, null, 2)
}

function objectFromJson(text, label) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return {}
  let value
  try { value = JSON.parse(trimmed) } catch { throw new Error(`${label}不是合法的 JSON`) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是 JSON 对象`)
  return value
}

/** 编辑草稿转成当前配置形状；每个模型必须是带 id、name、context、capabilities 的对象。 */
function providerPayload(draft) {
  return (draft.providers || []).map(provider => {
    const models = provider.models.map(model => {
      const result = {
        id: model.id.trim(),
        name: model.name.trim() || model.id.trim(),
        ...(String(model.family || '').trim() ? { family: String(model.family).trim() } : {}),
        context: Number(model.context) > 0 ? Number(model.context) : DEFAULT_CONTEXT,
        capabilities: [...model.capabilities],
      }
      if (Number.isInteger(Number(model.maxOutput)) && Number(model.maxOutput) > 0) result.maxOutput = Number(model.maxOutput)
      if (Number.isFinite(Number(model.temperature))) result.temperature = Number(model.temperature)
      if (Number.isFinite(Number(model.topP))) result.topP = Number(model.topP)
      if (Number.isInteger(Number(model.seed)) && Number(model.seed) >= 0) result.seed = Number(model.seed)
      if (model.body && typeof model.body === 'object' && !Array.isArray(model.body) && Object.keys(model.body).length) result.body = model.body
      return result
    })
    return {
      name: provider.name.trim(),
      baseURL: provider.apiUrl || '',
      apiKey: provider.apiKey || '',
      enabled: provider.enabled !== false,
      protocol: provider.apiType || 'openai-compatible',
      stream: provider.stream !== false,
      headers: objectFromJson(provider.headers, '自定义请求头'),
      body: objectFromJson(provider.body, '额外请求体'),
      models,
    }
  })
}

async function fetchModels(provider, currentModels = []) {
  const baseURL = provider?.apiUrl?.trim().replace(/\/+$/, '')
  if (!baseURL) {
    Notice.show('请先填写请求地址（API）')
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
      .map(id => ({ id, name: id, family: '', context: DEFAULT_CONTEXT, capabilities: ['text', 'tools'] }))
    if (!discovered.length) throw new Error('接口未返回可用模型')
    return discovered
  } catch (error) {
    Notice.show(error.message)
    return currentModels.map(model => ({ ...model }))
  }
}

/** 合并远程发现和手动模型，按 ID 去重且不丢失已编辑的条目。 */
async function discoverModels(provider, currentModels = []) {
  const discovered = await fetchModels(provider, currentModels)
  const merged = new Map()
  for (const model of discovered) merged.set(model.id, model)
  for (const model of currentModels) merged.set(model.id, model) // 已编辑的名称和能力优先于远程目录
  return [...merged.values()]
}

function toggleModelInList(models, model) {
  const exists = models.some(item => item.id === model.id)
  if (exists) return models.filter(item => item.id !== model.id)
  return [...models, { ...model }]
}

async function suggestFamily(model) {
  if (!model) return null
  try {
    return await AgentAPI.getModelFamily(model)
  } catch {
    return null
  }
}

export const Provider = { createDraft, map: providerMap, payload: providerPayload, jsonText, discoverModels, toggleModelInList, testConnection, suggestFamily }
