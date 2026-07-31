/*
设置指令：负责设置页草稿、提供商、模型和权限的全部编辑动作。
草稿由 Vue 页面持有以隔离未保存输入；组件事件只把当前数据和反馈引用交给本指令修改。
调用示例：await Settings.loadPage()、Settings.addProvider(modelValue, emit, state)。
*/
import { AgentAPI } from '../api.js'                       // 引入权限目标工具读取指令
import { useConfigStore } from '../store.js'               // 引入已保存配置数据
import { Config } from './config.js'                       // 引入配置读取、保存和测试指令


// --- 复制配置草稿 ---
function cloneConfig(source) {
  return JSON.parse(JSON.stringify(source))                // API 配置只含 JSON 值，复制后不污染运行数据
}


// --- 加载设置页面数据 ---
async function loadPage(draft, toolNames) {
  const [config, tools] = await Promise.all([Config.load(), AgentAPI.listTools()]) // 并行读取配置和权限目标
  toolNames.value = tools.map((tool) => tool.name)      // 写入权限编辑器需要的工具名称
  draft.value = config ? cloneConfig(config) : null    // 写入与运行配置隔离的页面草稿
}


// --- 保存设置页面草稿 ---
async function savePage(draft, isProviderValid) {
  if (!isProviderValid.value) return false             // 无效提供商字段不能覆盖已保存配置
  const changes = {                                    // 只提交核心设置页面负责的字段
    activeProvider: draft.value.activeProvider,        // 保存当前提供商名称
    activeModel: draft.value.activeModel,              // 保存当前模型名称
    providers: draft.value.providers,                  // 完整替换提供商和模型目录
    systemPrompt: draft.value.systemPrompt,            // 保存 Agent 系统指令
    permissions: draft.value.permissions,              // 保存完整工具权限映射
  }
  const saved = await Config.save(changes)             // 将草稿写入 Server 并刷新运行配置
  if (saved) draft.value = cloneConfig(useConfigStore().config) // 成功后写入 Server 最终配置草稿
  return saved                                         // 返回是否保存完成
}


// --- 修改权限草稿 ---
function setPermissions(draft, permissions) {
  draft.value = { ...draft.value, permissions }        // 将新权限映射写入完整设置草稿
}


// --- 修改系统提示词草稿 ---
function setSystemPrompt(draft, systemPrompt) {
  draft.value = { ...draft.value, systemPrompt }        // 将 Agent 指令写入完整设置草稿
}


// --- 修改提供商校验状态 ---
function setProviderValidity(providerValid, isValid) {
  providerValid.value = isValid                         // 保存当前表单是否允许提交
}


// --- 选择一个提供商详情 ---
function selectProvider(selectedProvider, providerName) {
  selectedProvider.value = providerName                // 将详情区域切换到用户选择的提供商
}


// --- 修改待添加模型名称 ---
function setNewModelName(newModelName, value) {
  newModelName.value = value                            // 保存用户尚未提交的模型 ID
}


// --- 修改一个简单权限 ---
function updatePermission(permissions, emit, toolName, permission) {
  emit('update', { ...permissions, [toolName]: permission }) // 返回只替换目标工具规则的完整映射
}


// --- 同步有效提供商选择 ---
function syncSelectedProvider(names, selectedProvider) {
  if (names.includes(selectedProvider.value)) return   // 当前选择仍存在时保持详情上下文
  selectedProvider.value = names[0] ?? ''             // 首次加载或删除后回退到首项
}


// --- 同步提供商局部反馈 ---
function syncProviderFeedback(currentProvider, headersText, headersError, testState) {
  headersText.value = JSON.stringify(currentProvider?.headers ?? {}, null, 2) // 读取当前服务请求头草稿
  headersError.value = ''                              // 不携带上一服务的校验错误
  testState.value = null                               // 测试反馈只属于触发时服务
}


// --- 替换提供商集合 ---
function updateProviders(modelValue, emit, providers, activeChanges = {}) {
  emit('update:modelValue', { ...modelValue, ...activeChanges, providers }) // 向设置页返回完整新草稿
}


// --- 新增一个提供商 ---
function addProvider(modelValue, providerNames, emit, selectedProvider, providerError) {
  let index = providerNames.length + 1                 // 从当前数量生成稳定默认名称
  let name = `provider-${index}`                       // 创建首个候选身份
  while (modelValue.providers?.[name]) name = `provider-${++index}` // 避免覆盖已有提供商
  const provider = {                                   // 使用 Server 规范创建完整默认草稿
    protocol: 'openai-compatible',                     // 通用端点作为保守默认协议
    baseURL: '',                                       // 等待用户填写 API 地址
    apiKey: '',                                        // 不继承其他服务认证
    headers: {},                                       // 自定义请求头从空对象开始
    timeoutMs: 120000,                                 // 与 Server 默认两分钟一致
    cache: { enabled: false, mode: 'implicit' },       // 未明确开启前不添加缓存亲和键
    models: [],                                        // 模型由用户按真实 ID 添加
    modelSettings: {},                                 // 每模型限制随模型一起维护
  }
  updateProviders(modelValue, emit, { ...modelValue.providers, [name]: provider }) // 将完整新项写入草稿
  selectedProvider.value = name                       // 立即打开新提供商详情
  providerError.value = ''                            // 清除旧重命名反馈
}


// --- 重命名当前提供商 ---
function renameProvider(modelValue, emit, selectedProvider, providerError, renameLocked, rawName) {
  const newName = rawName.trim()                       // 提供商身份不保留首尾空白
  const oldName = selectedProvider.value               // 保存重命名前身份
  if (!newName || newName === oldName || renameLocked) return // 空名称、未变化或密钥锁定时保持现状
  if (modelValue.providers[newName]) {
    providerError.value = '该提供商名称已存在'        // 防止覆盖其他服务和认证
    return
  }
  const providers = {}                                 // 按原顺序重建键名映射
  for (const [name, provider] of Object.entries(modelValue.providers)) providers[name === oldName ? newName : name] = provider // 只替换当前服务身份
  const activeChanges = modelValue.activeProvider === oldName ? { activeProvider: newName } : {} // 同步当前模型归属
  updateProviders(modelValue, emit, providers, activeChanges) // 返回重命名后的完整草稿
  selectedProvider.value = newName                    // 保持详情打开
  providerError.value = ''                            // 成功后清除冲突反馈
}


// --- 修改当前提供商字段 ---
function updateProvider(modelValue, emit, selectedName, currentProvider, testState, field, value) {
  const providers = {                                 // 复制集合和当前详情保持单向数据流
    ...modelValue.providers,                           // 保留其他提供商声明
    [selectedName]: { ...currentProvider, [field]: value }, // 只替换目标字段
  }
  updateProviders(modelValue, emit, providers)         // 将字段变化写入设置草稿
  testState.value = null                               // 草稿变化后旧测试反馈失效
}


// --- 修改缓存字段 ---
function updateCache(modelValue, emit, selectedName, currentProvider, testState, field, value) {
  updateProvider(modelValue, emit, selectedName, currentProvider, testState, 'cache', { ...currentProvider.cache, [field]: value }) // 保留缓存对象另一字段
}


// --- 校验并修改请求头 ---
function updateHeaders(modelValue, emit, selectedName, currentProvider, testState, headersText, headersError, rawText) {
  headersText.value = rawText                          // 始终保留用户正在编辑的原始 JSON
  try {
    const headers = JSON.parse(rawText || '{}')        // 将文本解析为 Server 需要的对象
    if (!headers || Array.isArray(headers) || typeof headers !== 'object') throw new Error('请求头必须是 JSON 对象') // 拒绝数组和标量
    if (Object.values(headers).some((value) => typeof value !== 'string')) throw new Error('请求头值必须是字符串') // HTTP 请求头只接受字符串值
    headersError.value = ''                            // 有效对象清除旧错误
    updateProvider(modelValue, emit, selectedName, currentProvider, testState, 'headers', headers) // 只有有效 JSON 进入草稿
  } catch (error) {
    headersError.value = error.message                 // 无效输入保留原文供继续修正
  }
}


// --- 删除当前提供商 ---
function removeProvider(modelValue, emit, selectedName) {
  const providers = { ...modelValue.providers }        // 复制集合避免修改父级对象
  delete providers[selectedName]                       // 从完整提交集合移除服务
  const nextName = Object.keys(providers)[0] ?? ''     // 选择剩余首项作为回退
  const nextModel = providers[nextName]?.models?.[0] ?? '' // 读取回退服务首个模型
  const activeChanges = modelValue.activeProvider === selectedName ? { activeProvider: nextName, activeModel: nextModel } : {} // 防止活动模型悬空
  updateProviders(modelValue, emit, providers, activeChanges) // 返回删除后的完整草稿
}


// --- 添加模型到当前提供商 ---
function addModel(modelValue, emit, selectedName, currentProvider, testState, newModelName) {
  const modelName = newModelName.value.trim()          // 模型 ID 不保留首尾空白
  const models = currentProvider?.models ?? []         // 读取当前模型清单
  if (!modelName || models.includes(modelName)) return // 空值和重复项不修改配置
  updateProvider(modelValue, emit, selectedName, currentProvider, testState, 'models', [...models, modelName]) // 将新模型追加到当前服务
  newModelName.value = ''                              // 清空输入反馈添加完成
}


// --- 删除一个模型 ---
function removeModel(modelValue, emit, selectedName, currentProvider, testState, modelName) {
  const models = currentProvider.models.filter((item) => item !== modelName) // 生成剩余模型清单
  const modelSettings = { ...currentProvider.modelSettings } // 复制每模型限制映射
  delete modelSettings[modelName]                      // 同步清理已删除模型设置
  const isActive = modelValue.activeProvider === selectedName && modelValue.activeModel === modelName // 判断是否删除当前模型
  const activeChanges = isActive ? { activeModel: models[0] ?? '' } : {} // 活动模型回退到同服务首项
  const providers = { ...modelValue.providers, [selectedName]: { ...currentProvider, models, modelSettings } } // 写入完整新服务声明
  updateProviders(modelValue, emit, providers, activeChanges) // 返回模型删除后的完整草稿
  testState.value = null                               // 模型变化后旧连接测试反馈失效
}


// --- 修改模型生成限制 ---
function updateModelSetting(modelValue, emit, selectedName, currentProvider, testState, modelName, field, rawValue) {
  const settings = { ...(currentProvider.modelSettings?.[modelName] ?? {}) } // 复制目标模型设置
  if (rawValue === '') delete settings[field]          // 空字段恢复 Server 默认值
  else settings[field] = Number(rawValue)              // 数字控件转换为 JSON 数值
  const modelSettings = { ...currentProvider.modelSettings, [modelName]: settings } // 写回对应模型 ID
  updateProvider(modelValue, emit, selectedName, currentProvider, testState, 'modelSettings', modelSettings) // 保留其他模型设置
}


// --- 设为当前聊天模型 ---
function activateModel(modelValue, emit, selectedName, modelName) {
  emit('update:modelValue', { ...modelValue, activeProvider: selectedName, activeModel: modelName }) // 只更新活动模型草稿
}


// --- 测试一个已保存连接 ---
async function testSavedConnection(modelValue, selectedName, savedProvider, isTesting, testState) {
  if (!savedProvider || isTesting.value) return         // 新服务或进行中的测试不能重复触发
  isTesting.value = true                                // 测试动作进入禁用状态
  testState.value = null                                // 清除旧反馈
  const usesActiveModel = modelValue.activeProvider === selectedName && savedProvider.models?.includes(modelValue.activeModel) // 判断当前模型是否属于目标服务
  const modelName = usesActiveModel ? modelValue.activeModel : savedProvider.models?.[0] // 优先测试同服务当前模型
  testState.value = await Config.testConnection(selectedName, modelName) // 使用 Server 已保存认证执行请求
  isTesting.value = false                               // 恢复可重复测试状态
}


export const Settings = { cloneConfig, loadPage, savePage, setPermissions, setSystemPrompt, setProviderValidity, selectProvider, setNewModelName, updatePermission, syncSelectedProvider, syncProviderFeedback, addProvider, renameProvider, updateProvider, updateCache, updateHeaders, removeProvider, addModel, removeModel, updateModelSetting, activateModel, testSavedConnection } // 暴露全部设置指令
