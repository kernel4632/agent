/* 供应商与模型目录：读写字段映射、发现模型和连接测试。
 * 调用：Provider.discoverModels(provider, models)；Provider.testConnection(name, model)。
 * 编辑器的开关和未完成文本由组件自己保留，保存队列归 Settings。
 */
import { AgentAPI } from '../utils/api.js' // 已保存模型配置的连接测试
import { store } from '../store.js' // 保留没有参与编辑的原始参数
import { Notice } from './notice.js' // 发现模型失败时说明原因

/** 后端供应商数组变成界面模型目录；空配置提供可编辑起点。 */
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

/** 只覆盖编辑过的字段；供应商改名后仍保留来源里的参数。 */
function providerPayload(draft) {
  return (draft.providers || []).map(provider => {
    // 改名后还要能找到原来的那一份，才能保留密钥、请求头和模型设置。
    const original = (store.config.raw?.providers || []).find(item => item.name === (provider.sourceName || provider.name))
    const modelSettings = { ...(original?.modelSettings || {}) }        // 每个模型的上下文窗口单独存
    const models = (provider.models || []).map(model => {
      const id = typeof model === 'string' ? model : model.id || model.name
      const context = Number(model?.context)
      if (context > 0) modelSettings[id] = { ...modelSettings[id], context }
      else if (modelSettings[id]) {
        // 清空上下文窗口时只删这两个键，其他模型设置不动。
        const next = { ...modelSettings[id] }
        delete next.context
        delete next.contextWindow
        if (Object.keys(next).length) modelSettings[id] = next
        else delete modelSettings[id]
      }
      const name = String(model?.name || id).trim() || id
      const capabilities = Array.isArray(model?.capabilities) && model.capabilities.length ? [...model.capabilities] : ['文本', '工具']
      // 只改了默认值时仍存成字符串，保持旧配置格式，也避免无意义的对象膨胀。
      if (name === id && capabilities.length === 2 && capabilities[0] === '文本' && capabilities[1] === '工具') return id
      return { id, name, capabilities }
    })
    return {
      ...original,                                                     // 保留 id、密钥等上游不认识的字段
      name: provider.name.trim(),
      baseURL: provider.apiUrl || '',
      apiKey: provider.apiKey || '',
      enabled: provider.enabled !== false,
      protocol: provider.apiType || 'openai-compatible',
      ...(provider.stream === undefined ? {} : { stream: provider.stream }),
      headers: objectFromJson(provider.headers, '自定义请求头'),
      body: objectFromJson(provider.body, '额外请求体'),
      models,
      ...(Object.keys(modelSettings).length ? { modelSettings } : {}),
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
      .map(id => ({ id, name: id, capabilities: ['文本', '工具'] }))
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
  for (const model of currentModels) merged.set(model.id, model)
  for (const model of discovered) merged.set(model.id, model)
  return [...merged.values()]
}

function toggleModelInList(models, model) {
  const exists = models.some(item => item.id === model.id)
  if (exists) return models.filter(item => item.id !== model.id)
  return [...models, { ...model }]
}

export const Provider = { map: providerMap, payload: providerPayload, jsonText, discoverModels, toggleModelInList, testConnection }
