/*
配置指令：读取 Server 配置，并转换为设置页可编辑结构。
脱敏密钥原样保留到保存请求，Server 会恢复真实值。
调用示例：await Config.load()、await Config.testConnection('aker', 'glm-5.2')。
*/
import { AgentAPI } from '../api.js'                    // 引入配置 HTTP 契约
import { store } from '../store.js'                     // 引入全局配置


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
    apply(raw, catalog, agents)                           // 将 Server 数据转换为设置页面结构
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


// --- 应用 Server 配置到设置结构 ---
function apply(raw, catalog = [], catalogAgents = []) {
  // 后端 providers 是数组，每项包含 name、baseURL、apiKey、models 等字段
  const providerList = Array.isArray(raw.providers) ? raw.providers : []
  const providers = {}
  for (const p of providerList) {
    const key = p.name || '默认供应商'
    providers[key] = {
      enabled: p.enabled !== false,
      protocol: p.protocol || 'openai-compatible',
      baseURL: p.baseURL || p.api || '',
      apiKey: p.apiKey || p.key || '',
      models: Array.isArray(p.models) ? p.models.map(model => typeof model === 'string' ? model : model.id) : [],
      modelSettings: p.modelSettings || {},
      timeout: p.timeout || 120000,
      headers: p.headers || '{}',
    }
  }
  // 兜底：如果没有供应商，提供空的默认条目
  if (Object.keys(providers).length === 0) {
    providers['默认供应商'] = { enabled: true, protocol: 'openai-compatible', baseURL: '', apiKey: '', models: [], modelSettings: {}, timeout: 120000, headers: '{}' }
  }

  // 工具目录由 /tool/list 给出；旧后端没有目录时退回只看 permission 里的字符串规则。
  // toolCatalog 给对话页找渲染器，tools 只放设置页需要画权限开关的工具。
  const toolCatalog = Array.isArray(catalog) ? catalog : []
  const toolSettings = toolCatalog.length
    ? toolCatalog
      .filter(tool => tool.configurable !== false)
      .map(tool => ({
        name: tool.name,
        title: tool.ui?.title || tool.name,
        kind: tool.kind,
        enabled: tool.permission !== 'deny',
        permission: tool.permission,
        original: tool.permission,
        // 工具脚本声明的渲染信息；设置页保存时不会把它写回 permission。
        ui: tool.ui && typeof tool.ui === 'object' && !Array.isArray(tool.ui) ? tool.ui : null,
      }))
    : Object.entries(raw.permission || {})
      .filter(([, action]) => typeof action === 'string')
      .map(([name, action]) => ({ name, title: name, kind: 'other', enabled: action !== 'deny', permission: action, original: action }))

  const mcp = Object.entries(raw.mcp ?? {}).map(([name, definition]) => {
    // 老配置可能只写了 url 没写 transport；补成 sse，保存时才不会被当成 stdio 命令。
    const normalized = structuredClone(definition || {})
    if (!normalized.transport) normalized.transport = normalized.url ? 'sse' : 'stdio'
    return {
      id: name,
      name,
      command: normalized.command || normalized.url || '',
      enabled: normalized.enabled !== false,
      definition: normalized,
    }
  })

  const firstProvider = Object.keys(providers).find(key => providers[key].enabled && providers[key].models.length) || Object.keys(providers)[0] || ''
  const firstModels = providers[firstProvider]?.models || []
  const firstModel = typeof firstModels[0] === 'string' ? firstModels[0] : firstModels[0]?.id || ''
  // 设置页保存过默认模型时以它为准；供应商或模型被删掉再回退到第一个可用模型。
  const preferred = raw.model && typeof raw.model === 'object' ? raw.model : null
  const preferredModels = preferred ? providers[preferred.provider]?.models || [] : []
  const validPreferred = preferred?.provider && preferred?.model && preferredModels.includes(preferred.model)
  const activeProvider = validPreferred ? preferred.provider : firstProvider
  const activeModel = validPreferred ? preferred.model : firstModel

  const globalCapabilities = raw.capabilities && typeof raw.capabilities === 'object' ? raw.capabilities : {}
  const globalUses = raw.uses && typeof raw.uses === 'object' && !Array.isArray(raw.uses) ? raw.uses : {}
  const compactThreshold = Number(raw.compactThreshold)

  // 智能体清单：优先后端 /agent/list；旧后端没有这个接口时，从 agents / modes 原始配置拼。
  const agentDefinitions = raw.agents && typeof raw.agents === 'object' && !Array.isArray(raw.agents)
    ? raw.agents
    : raw.modes && typeof raw.modes === 'object' && !Array.isArray(raw.modes) ? raw.modes : {}
  const customAgents = Object.entries(agentDefinitions)
    .filter(([name, value]) => /^[a-zA-Z0-9_-]+$/.test(name) && value && typeof value === 'object' && !Array.isArray(value))
    .filter(([name]) => !['build', 'plan', 'ask', 'debug'].includes(name))
    .map(([name, value]) => ({
      name,
      label: typeof value.label === 'string' && value.label.trim() ? value.label.trim() : name,
      description: typeof value.description === 'string' ? value.description : '',
      readOnly: value.readOnly === true,
    }))
  const agents = Array.isArray(catalogAgents) && catalogAgents.length
    ? catalogAgents
    : [
      { name: 'build', label: '执行', description: '可以改文件、执行命令', readOnly: false },
      { name: 'plan', label: '计划', description: '只读工具，先看清再动手', readOnly: true },
      { name: 'ask', label: '问答', description: '只回答和解释，不碰文件', readOnly: true },
      { name: 'debug', label: '调试', description: '复现、定位、最小修复', readOnly: false },
      ...customAgents,
    ]

  Object.assign(store.config, {
    providers,
    tools: toolSettings,
    toolCatalog,
    mcp,
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
    compactThreshold: Number.isFinite(compactThreshold) && compactThreshold >= 0.1 && compactThreshold <= 0.99 ? compactThreshold : 0.8,
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
