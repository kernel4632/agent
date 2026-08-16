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
    apply(raw)                                            // 将 Server 数据转换为设置页面结构
    return true                                           // 反馈应用启动可以继续
  } catch (error) {
    store.ui.errorMessage = error.message                 // 页面展示真实连接或协议错误
    return false                                          // 不制造假配置
  }
}


// --- 应用 Server 配置到设置结构 ---
function apply(raw) {
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
      models: Array.isArray(p.models) ? p.models : [],
      modelSettings: p.modelSettings || {},
      timeout: p.timeout || 120000,
      headers: p.headers || '{}',
    }
  }
  // 兜底：如果没有供应商，提供空的默认条目
  if (Object.keys(providers).length === 0) {
    providers['默认供应商'] = { enabled: true, protocol: 'openai-compatible', baseURL: '', apiKey: '', models: [], modelSettings: {}, timeout: 120000, headers: '{}' }
  }

  // 后端 permission 是规则数组，前端工具设置需要按工具名聚合
  const permissionRules = Array.isArray(raw.permission) ? raw.permission : []
  const toolMap = {}
  for (const rule of permissionRules) {
    if (!rule.tool || rule.tool === '*') continue          // 跳过通配符规则
    if (!toolMap[rule.tool]) toolMap[rule.tool] = rule.action
  }
  const toolSettings = Object.entries(toolMap).map(([name, action]) => ({
    name, title: name, enabled: action !== 'deny', permission: action,
  }))

  const mcp = Object.entries(raw.mcp ?? {}).map(([name, definition]) => ({
    id: name,
    name,
    command: definition.command || definition.url || '',
    enabled: definition.enabled !== false,
    definition: structuredClone(definition),
  }))

  const firstProvider = Object.keys(providers)[0] || ''
  const firstModels = providers[firstProvider]?.models || []
  const activeModel = typeof firstModels[0] === 'string' ? firstModels[0] : firstModels[0]?.id || ''

  Object.assign(store.config, {
    providers,
    tools: toolSettings,
    mcp,
    prompt: raw.prompts?.system || '',
    appearance: store.config.appearance,
    activeProvider: firstProvider,
    activeModel,
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
