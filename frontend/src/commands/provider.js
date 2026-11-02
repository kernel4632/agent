/* 供应商与模型目录：读写字段映射、发现模型和连接测试。
 * 调用：Provider.discoverModels(provider, models)；Provider.testConnection(name, model)。
 * 编辑器的开关和未完成文本由组件自己保留，保存队列归 Settings。
 */
import { AgentAPI } from '../utils/api.js' // 已保存模型配置的连接测试
import { Notice } from './notice.js' // 发现模型失败时说明原因
import { DEFAULT_CONTEXT } from '../defaults.js' // 没有填写模型窗口时采用后端默认值

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
    const models = provider.models.map(model => ({
      id: model.id.trim(),
      name: model.name.trim() || model.id.trim(),
      context: Number(model.context) > 0 ? Number(model.context) : DEFAULT_CONTEXT,
      capabilities: [...model.capabilities],
    }))
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
      .map(id => ({ id, name: id, context: DEFAULT_CONTEXT, capabilities: ['text', 'tools'] }))
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

export const Provider = { map: providerMap, payload: providerPayload, jsonText, discoverModels, toggleModelInList, testConnection }
