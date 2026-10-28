/*
配置指令：读取 Server 配置，并转换为设置页可编辑结构。
脱敏密钥原样保留到保存请求，Server 会恢复真实值。
调用示例：await Config.load()、await Config.testConnection('aker', 'glm-5.2')。
*/
import { AgentAPI } from './api.js'                    // 引入配置 HTTP 契约
import { store } from './store.js'                     // 引入全局配置
import { COMPACT_RANGE, DEFAULT_SETTINGS } from './defaults.js' // 前端默认值只留一处


// --- 加载完整设置数据 ---
async function load() {
  try {
    const raw = await AgentAPI.getConfig()               // 读取脱敏持久化配置
    let catalog = []
    try {
      catalog = await AgentAPI.getTools()                 // 全部工具和当前权限
    } catch {
      catalog = []                                       // 旧后端没有目录接口时退回权限表
    }
    let agents = []
    try {
      agents = await AgentAPI.getAgents()                  // 内置和自定义智能体
    } catch {
      agents = []                                        // 旧后端没有这个接口时从原始配置拼
    }
    let kinds = []
    try {
      kinds = await AgentAPI.getToolKinds()                // 自动批准类别的名字和顺序
    } catch {
      kinds = []                                         // 旧后端没有这个接口时开关为空
    }
    let meta = { uses: [] }
    try {
      meta = await AgentAPI.getConfigMeta()                // “按用途配模型”的标签和说明
    } catch {
      meta = { uses: [] }                                // 旧后端没有这个接口时不画用途选择
    }
    apply(raw, catalog, agents, kinds, meta)              // 将 Server 数据转换为设置页面结构
    try {
      const commands = await AgentAPI.getCommands()       // 读取用户自定义的斜杠命令
      store.commands = Array.isArray(commands) ? commands : []
    } catch {
      store.commands = []                                 // 旧后端没有这个接口时不影响启动
    }
    store.ui.errorMessage = ''
    return true                                           // 反馈应用启动可以继续
  } catch (error) {
    store.ui.errorMessage = error.message                 // 页面展示真实连接或协议错误
    return false                                          // 不制造假配置
  }
}


// --- 供应商：后端数组转成设置页按名字索引的对象 ---
function providerMap(raw) {
  const list = Array.isArray(raw.providers) ? raw.providers : []
  const providers = {}
  for (const provider of list) {
    const key = provider.name || '默认供应商'
    providers[key] = {
      enabled: provider.enabled !== false,
      protocol: provider.protocol || 'openai-compatible',
      baseURL: provider.baseURL || provider.api || '',
      apiKey: provider.apiKey || provider.key || '',
      models: Array.isArray(provider.models) ? provider.models.map(model => typeof model === 'string' ? model : model.id) : [],
      modelSettings: provider.modelSettings || {},
      timeout: provider.timeout || 120000,
      headers: provider.headers || '{}',
    }
  }
  // 没有供应商时给一个空条目，设置页才有地方输入第一份配置。
  if (!Object.keys(providers).length) {
    providers['默认供应商'] = { enabled: true, protocol: 'openai-compatible', baseURL: '', apiKey: '', models: [], modelSettings: {}, timeout: 120000, headers: '{}' }
  }
  return providers
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
  const providers = providerMap(raw)
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


// --- 测试已保存模型连接 ---
async function testConnection(providerName, modelName) {
  try {
    return await AgentAPI.testProvider(providerName, modelName) // 使用 Server 已保存认证执行真实测试
  } catch (error) {
    return { ok: false, provider: providerName, model: modelName, error: error.message } // 返回结构化失败反馈
  }
}


export const Config = { load, apply, testConnection }   // 暴露配置加载、转换和连接测试动作
