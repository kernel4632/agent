/*
设置指令：负责隔离草稿、保存、模型发现和离页自动保存。
保存时把页面字段转换回 Server 配置结构，成功后重新加载最终生效数据。
调用示例：Settings.open()、await Settings.save()、Settings.discoverModels()。
*/
import { AgentAPI } from '../api.js'                    // 引入正式配置和能力 HTTP 契约
import { store } from '../store.js'                     // 引入已保存配置和设置反馈
import { Config } from './config.js'                    // 引入保存后的配置重新加载动作
import { UI } from './ui.js'                            // 引入保存错误轻反馈

let initialBackendDraft = ''


// --- 后端配置里由设置页负责的字段 ---
function backendSnapshot(draft) {
  return JSON.stringify({
    providers: draft.providers,
    prompt: draft.prompt,
    rules: draft.rules,
    agents: draft.agentDefinitions,
    model: draft.defaultModel,
    capabilities: draft.capabilities,
    uses: draft.uses,
    compactThreshold: draft.compactThreshold,
    autoTitle: draft.autoTitle,
    mcp: draft.mcp,
    tools: draft.tools,
    diagnostics: draft.diagnostics,
    snapshot: draft.snapshot,
  })
  // appearance 只存浏览器本地；切换主题不应该额外写一次后端配置。
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
    sourceName: name,
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
    rules: store.config.rules,
    agentDefinitions: store.config.agentDefinitions,
    defaultModel: { provider: store.config.activeProvider, model: store.config.activeModel },
    capabilities: { ...store.config.capabilities },
    uses: { ...store.config.uses },
    compactThreshold: store.config.compactThreshold,
    autoTitle: store.config.autoTitle,
    diagnostics: store.config.diagnostics,
    snapshot: store.config.snapshot,
    appearance: store.config.appearance,
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

async function doPersist({ keepDraft = false, silent = false } = {}) {
  const draft = store.settings.draft
  if (!draft) return false
  store.settings.isSaving = true
  try {
    if (backendSnapshot(draft) === initialBackendDraft) {
      store.config.appearance = isolateDraft(draft.appearance)
      persistAppearance(draft.appearance)
      store.settings.savedAt = Date.now()
      lastAutoSaveError = ''
      if (!keepDraft) store.settings.draft = null
      return true
    }
    const names = (draft.providers || []).map(provider => provider.name.trim())
    if (names.some(name => !name) || new Set(names).size !== names.length) throw new Error('供应商名称不能为空或重复')
    const mcpNames = (draft.mcp || []).map(item => (item.name || '').trim())
    if (mcpNames.some(name => !name) || new Set(mcpNames).size !== mcpNames.length) throw new Error('MCP 服务名称不能为空或重复')
    const providers = (draft.providers || []).map(provider => ({
      ...(store.config.raw?.providers || []).find(item => item.name === (provider.sourceName || provider.name)),
      name: provider.name.trim(),
      baseURL: provider.apiUrl || '',
      apiKey: provider.apiKey || '',
      enabled: provider.enabled !== false,
      protocol: provider.apiType || 'openai-compatible',
      models: (provider.models || []).map(model => {
        const id = typeof model === 'string' ? model : model.id || model.name
        const original = (store.config.raw?.providers || []).find(item => item.name === (provider.sourceName || provider.name))?.models?.find(item => (typeof item === 'string' ? item : item.id) === id)
        return original === undefined ? id : isolateDraft(original)
      }),
    }))
    // 工具开关写回 permission；只写用户真的改过的那几个，没动过的规则保持原样。
    // 对象规则里的参数模式也要保留，只改默认动作。
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

    // MCP 数组转回后端认的对象：键是服务名；远程服务存 url，本地服务存 command。
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
    await AgentAPI.updateConfig({
      ...JSON.parse(JSON.stringify(store.config.raw || {})),
      providers,
      mcp,
      permission,
      prompt: { ...store.config.raw?.prompt, system: draft.prompt },
      rules: draft.rules,
      agents: draft.agentDefinitions,
      model: draft.defaultModel,
      capabilities: draft.capabilities,
      uses: draft.uses,
      compactThreshold: draft.compactThreshold,
      autoTitle: draft.autoTitle,
      diagnostics: draft.diagnostics,
      snapshot: draft.snapshot,
    })
    store.config.appearance = isolateDraft(draft.appearance)
    persistAppearance(draft.appearance)
    if (!await Config.load()) throw new Error('设置已发送，但重新读取失败。请重试连接以确认保存状态。')
    store.settings.savedAt = Date.now()
    initialBackendDraft = backendSnapshot(draft)
    lastAutoSaveError = ''
    if (!keepDraft) store.settings.draft = null
    return true
  } catch (error) {
    if (!silent || lastAutoSaveError !== error.message) UI.notify(error.message)
    lastAutoSaveError = error.message
    return false
  } finally {
    store.settings.isSaving = false
  }
}

async function save() {
  return persist()
}

// 输入变化时调用：成功后保留草稿和当前焦点，不重建正在编辑的页面。
async function autoSave() {
  return persist({ keepDraft: true, silent: true })
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


// --- 设置里的二级页面：供应商、MCP 服务、工具等 ---
// 只存一个 id 和标题；具体内容由当前页面从草稿里查，避免复制一份实体数据。
function openDetail({ id, title = '' } = {}) {
  if (!id) return
  store.ui.settingsDetail = { id, title }
}

function closeDetail() {
  store.ui.settingsDetail = null
}

function updateDetailTitle(title) {
  if (!store.ui.settingsDetail) return
  store.ui.settingsDetail = { ...store.ui.settingsDetail, title: title || '' }
}


export const Settings = {
  open, save, autoSave, replaceDraftAndSave, discoverModels, toggleModelInList,
  openDetail, closeDetail, updateDetailTitle,
}
