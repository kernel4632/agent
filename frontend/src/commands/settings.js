/* 设置：加载配置、隔离编辑草稿、校验并串行保存。
 * 调用：await Settings.load()；Settings.open()；await Settings.autoSave()。
 * 供应商数据映射交给 Provider，外观持久化交给 Appearance；不反向调用导航。
 */
import { AgentAPI } from '../utils/api.js' // 只通过统一契约请求后端
import { store } from '../store.js' // 已保存配置与隔离草稿
import { Notice } from './notice.js' // 错误反馈不依赖导航
import { Provider } from './provider.js' // 供应商参数转换只有一处
import { Appearance } from './appearance.js' // 外观只写浏览器偏好

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
  const providers = Provider.map(raw)
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
    enabled: provider.enabled !== false,                 // 未明确关闭的供应商视为启用
    apiType: provider.protocol || 'openai-compatible',  // protocol 映射为前端选择器使用的 apiType 字段
    apiUrl: provider.baseURL || '',                      // Server 的 baseURL 对应编辑器中的请求地址
    apiKey: provider.apiKey || '',                       // 密钥只保存在草稿内存和后端配置
    stream: provider.stream,                             // 流式开关属于供应商连接
    headers: Provider.jsonText(provider.headers) || '{}',         // 自定义请求头以 JSON 文本编辑
    body: Provider.jsonText(provider.body) || '{}',               // 额外请求体以 JSON 文本编辑
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

// --- 整份设置按当前后端形状提交；不发送已经移除的配置项 ---
function configPayload(draft) {
  return {
    providers: Provider.payload(draft),
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

export const Settings = { load, apply, open, save, autoSave, replaceDraftAndSave }
