/* 设置：加载配置、隔离编辑草稿、校验并串行保存。
 * 调用：await Settings.load()；Settings.open()；await Settings.autoSave()。
 * 供应商数据映射交给 Provider，外观持久化交给 Appearance；不反向调用导航。
 */
import { AgentAPI } from '../utils/api.js' // 只通过统一契约请求后端
import { store } from '../store.js' // 已保存配置与隔离草稿
import { Notice } from './notice.js' // 错误反馈不依赖导航
import { Provider } from './provider.js' // 供应商参数转换只有一处
import { Appearance } from './appearance.js' // 外观只写浏览器偏好
import { COMPACT_RANGE, DEFAULT_SETTINGS } from '../defaults.js' // 默认值共享

// --- 加载完整设置数据 ---
async function load() {
  try {
    // 这些接口属于同一版后端，缺任何一个都说明连接不对；不再为旧后端逐项兜底。
    const [raw, catalog, agents, kinds, meta, commands] = await Promise.all([
      AgentAPI.getConfig(),                              // 脱敏持久化配置
      AgentAPI.getTools(),                               // 全部工具和当前权限
      AgentAPI.getAgents(),                              // 内置和自定义智能体
      AgentAPI.getToolKinds(),                           // 工具类别的名字和顺序
      AgentAPI.getConfigMeta(),                          // “按用途配模型”的标签和说明
      AgentAPI.getCommands(),                            // 用户自定义的斜杠命令
    ])
    apply(raw, catalog, agents, kinds, meta)              // 将 Server 数据转换为设置页面结构
    store.commands = Array.isArray(commands) ? commands : []
    store.ui.errorMessage = ''
    return true                                           // 反馈应用启动可以继续
  } catch (error) {
    store.ui.errorMessage = error.message                 // 页面展示真实连接或协议错误
    return false                                          // 不制造假配置
  }
}

// --- 工具目录：新后端给完整目录，旧后端退回 permission 里的字符串规则 ---
function toolSettingsFor(raw, catalog) {
  const toolCatalog = Array.isArray(catalog) ? catalog : []
  const tools = toolCatalog.length
    ? toolCatalog
      .filter(tool => tool.configurable !== false)
      .map(tool => ({
        name: tool.name,
        title: tool.ui?.title || tool.name,
        kind: tool.kind,
        kindLabel: tool.kindLabel || tool.kind,
        kindHint: tool.kindHint || '',
        enabled: tool.permission !== 'deny',
        permission: tool.permission,
        original: tool.permission,
        // 工具脚本声明的渲染信息；设置页保存时不会把它写回 permission。
        ui: tool.ui && typeof tool.ui === 'object' && !Array.isArray(tool.ui) ? tool.ui : null,
      }))
    : Object.entries(raw.permission || {})
      .filter(([, action]) => typeof action === 'string')
      .map(([name, action]) => ({ name, title: name, kind: 'other', enabled: action !== 'deny', permission: action, original: action }))
  return { toolCatalog, tools }
}

// --- MCP 服务：对象转成设置页的数组，并补上旧配置缺的 transport ---
function mcpList(raw) {
  return Object.entries(raw.mcp ?? {}).map(([name, definition]) => {
    const normalized = structuredClone(definition || {})
    // 老配置可能只写了 url 没写 transport；补成 sse，保存时才不会被当成 stdio 命令。
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
  const firstProvider = Object.keys(providers).find(key => providers[key].enabled && providers[key].models.length) || Object.keys(providers)[0] || ''
  const firstModel = providers[firstProvider]?.models?.[0] || ''
  const preferred = raw.model && typeof raw.model === 'object' ? raw.model : null
  const preferredModels = preferred ? providers[preferred.provider]?.models || [] : []
  const valid = preferred?.provider && preferred?.model && preferredModels.includes(preferred.model)
  return {
    activeProvider: valid ? preferred.provider : firstProvider,
    activeModel: valid ? preferred.model : firstModel,
  }
}

// --- 智能体：清单只来自后端 /agent/list；原始定义用于设置页编辑 ---
function agentList(raw, catalogAgents) {
  const agentDefinitions = raw.agents && typeof raw.agents === 'object' && !Array.isArray(raw.agents) ? raw.agents : {}
  const agents = Array.isArray(catalogAgents) ? catalogAgents : []
  return { agents, agentDefinitions }
}

// --- 应用 Server 配置到设置结构 ---
function apply(raw, catalog = [], catalogAgents = [], catalogKinds = [], meta = {}) {
  const providers = Provider.map(raw)
  const { toolCatalog, tools } = toolSettingsFor(raw, catalog)
  const { activeProvider, activeModel } = modelChoice(providers, raw)
  const { agents, agentDefinitions } = agentList(raw, catalogAgents)

  const globalCapabilities = raw.capabilities && typeof raw.capabilities === 'object' ? raw.capabilities : {}
  const globalUses = raw.uses && typeof raw.uses === 'object' && !Array.isArray(raw.uses) ? raw.uses : {}
  const compactThreshold = Number(raw.compactThreshold)

  Object.assign(store.config, {
    providers,
    tools,
    toolCatalog,
    kindOptions: Array.isArray(catalogKinds) ? catalogKinds : [],
    useOptions: Array.isArray(meta.uses) ? meta.uses : [],
    mcp: mcpList(raw),
    prompt: raw.prompt?.system || '',
    agents,
    agentDefinitions,
    rules: { enabled: raw.rules?.enabled !== false },
    diagnostics: raw.diagnostics && typeof raw.diagnostics === 'object' ? raw.diagnostics : {},
    snapshot: raw.snapshot && typeof raw.snapshot === 'object' ? raw.snapshot : {},
    appearance: store.config.appearance,
    activeProvider,
    activeModel,
    capabilities: {
      image: globalCapabilities.image !== false,
      cache: globalCapabilities.cache !== false,
      stream: globalCapabilities.stream !== false,
    },
    uses: globalUses,
    compactThreshold: Number.isFinite(compactThreshold) && compactThreshold >= COMPACT_RANGE.min && compactThreshold <= COMPACT_RANGE.max ? compactThreshold : DEFAULT_SETTINGS.compactThreshold,
    autoTitle: raw.autoTitle !== false,
    raw: structuredClone(raw),
  })
}

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
    stream: provider.stream,                             // 不写时跟随全局的流式开关
    headers: Provider.jsonText(provider.headers) || '{}',         // 自定义请求头以 JSON 文本编辑
    body: Provider.jsonText(provider.body) || '{}',               // 额外请求体以 JSON 文本编辑
    models: (provider.models || []).map(model => {
      const id = typeof model === 'string' ? model : model.id || model.name
      const settings = provider.modelSettings?.[id] || {}
      return {
        id,
        name: typeof model === 'string' ? model : model.name || id,
        capabilities: Array.isArray(model?.capabilities) && model.capabilities.length ? [...model.capabilities] : ['文本', '工具'],
        context: Number(settings.context || settings.contextWindow || 0), // 0 表示没有单独设置
      }
    }),
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

// --- 整份设置发给后端；上游不认识的字段原样带上 ---
function configPayload(draft) {
  return {
    ...JSON.parse(JSON.stringify(store.config.raw || {})),
    providers: Provider.payload(draft),
    mcp: mcpPayload(draft),
    permission: permissionPayload(draft),
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
    // 改名已经落盘；草稿里的来源名也跟上，下一次自动保存才不会按旧名字找丢请求头和模型设置。
    for (const provider of draft.providers || []) provider.sourceName = provider.name.trim()
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

async function save() {
  return persist()
}

// 输入变化时调用：成功后保留草稿和当前焦点，不重建正在编辑的页面。
async function autoSave() {
  return persist({ keepDraft: true, silent: true })
}

async function replaceDraftAndSave(snapshot) {
  store.settings.draft = isolateDraft(snapshot)
  return save()
}

export const Settings = { load, apply, open, save, autoSave, replaceDraftAndSave }
