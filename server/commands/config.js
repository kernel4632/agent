/*
配置指令集：加载、读取、更新配置，并按当前选择创建真实模型。
配置只在此处读写磁盘，store/config.js 仅保存当前值和文件位置。
调用示例：await Config.load('C:/Users/me/.agent/config.json')、Config.getActiveModel()。
*/
import { mkdir } from 'node:fs/promises'                          // 引入创建配置目录的文件能力
import { dirname } from 'node:path'                               // 引入提取配置父目录的路径能力
import { createOpenAI } from '@ai-sdk/openai'                     // 引入支持 Responses API 缓存的 OpenAI 提供商
import { createOpenAICompatible } from '@ai-sdk/openai-compatible' // 引入 OpenAI-compatible 模型提供商
import { generateText } from 'ai'                                  // 引入供应商连通性测试所需的最小生成调用
import { defu } from 'defu'                                      // 引入配置深度合并能力
import { configStore } from '../store/config.js'                  // 引入唯一配置状态

const defaultConfig = {                                          // 首次运行时写入的可编辑默认配置
  activeProvider: '',                                             // 未配置供应商时不猜测用户选择
  activeModel: '',                                                // 未配置模型时保持为空
  providers: {},                                                  // 供应商由用户或配置 API 添加
  systemPrompt: '你是一个有用的 AI 助手，能够通过调用工具帮助用户完成任务。', // 每轮模型调用使用的系统指令
  permissions: {},                                                // 未声明工具按 ask 处理
  modelLimits: {},                                                // 模型上下文限制按模型名称保存
}


// --- 加载磁盘配置 ---
async function load(filePath) {
  configStore.filePath = filePath                                 // 记录后续保存使用的同一配置路径
  await mkdir(dirname(filePath), { recursive: true })              // 确保首次运行时配置目录存在

  const file = Bun.file(filePath)                                 // 从传入路径定位用户配置文件
  const savedConfig = await file.exists() ? await file.json() : {} // 文件不存在时从默认配置开始
  configStore.value = defu(savedConfig, defaultConfig)             // 补齐缺失字段，同时保留用户值
  normalizeProviders(configStore.value.providers)                  // 将旧供应商记录升级为显式协议和请求设置
  await save()                                                     // 将补齐后的完整结构同步到磁盘
  return configStore.value                                        // 向启动流程反馈当前配置
}


// --- 保存当前配置 ---
async function save() {
  if (!configStore.value || !configStore.filePath) {               // 尚未加载时拒绝产生位置不明的文件
    throw new Error('configuration has not been loaded')
  }

  const json = `${JSON.stringify(configStore.value, null, 2)}\n`   // 使用稳定缩进便于用户直接编辑
  await Bun.write(configStore.filePath, json)                       // 集中完成配置持久化副作用
}


// --- 读取完整配置 ---
function get() {
  return structuredClone(configStore.value)                        // 返回副本，防止路由绕过 update 修改状态
}


// --- 合并配置更新 ---
async function update(changes) {
  const nextChanges = structuredClone(changes)                     // 复制请求，避免密钥修复修改路由输入
  if (nextChanges.providers) {                                     // 完整提供商编辑需要支持新增、修改和删除
    for (const [name, provider] of Object.entries(nextChanges.providers)) {
      const savedProvider = configStore.value.providers?.[name]    // 读取同名提供商未脱敏的认证配置
      const savedKey = savedProvider?.apiKey                       // 读取同名提供商未脱敏的真实密钥
      if (provider.apiKey === '[REDACTED]') provider.apiKey = savedKey // 未修改的脱敏占位符恢复为真实密钥
      for (const [header, value] of Object.entries(provider.headers ?? {})) { // 恢复设置页未修改的敏感请求头
        if (value === '[REDACTED]') provider.headers[header] = savedProvider?.headers?.[header] // 占位符不能成为真实上游请求值
      }
    }
  }

  configStore.value = defu(nextChanges, configStore.value)         // 普通局部字段继续深度保留未修改内容
  if ('providers' in nextChanges) configStore.value.providers = nextChanges.providers // 提供商集合按 UI 完整结果替换，删除才能生效
  normalizeProviders(configStore.value.providers)                  // 新旧 API 输入统一为完整供应商结构
  await save()                                                      // 写盘完成后才向 API 反馈成功
  return { ok: true }                                               // 返回统一成功结果
}


// --- 创建当前真实模型 ---
function getActiveModel() {
  const providerName = configStore.value.activeProvider            // 每次调用都读取最新供应商选择
  const modelName = configStore.value.activeModel                  // 每次调用都读取最新模型选择
  return createModel(providerName, modelName)                       // 将显式选择交给统一模型创建动作
}


// --- 创建指定供应商模型 ---
function createModel(providerName, modelName) {
  const providerConfig = configStore.value.providers[providerName] // 从指定供应商读取协议、密钥与接口地址
  if (!providerConfig || !modelName) {                              // 缺少真实调用参数时给出明确配置错误
    throw new Error('active provider and model must be configured')
  }

  const providerOptions = {                                        // 两类提供商共享用户配置的网络选项
    name: providerName,                                             // 保留配置中的供应商名称用于模型元数据
    apiKey: providerConfig.apiKey,                                  // 密钥只在内存中交给供应商
    baseURL: providerConfig.baseURL,                                // 使用用户配置的上游接口地址
    headers: providerConfig.headers,                                // 将用户声明的自定义请求头应用到每次调用
    fetch: createTimeoutFetch(providerConfig.timeoutMs),            // 为连接和流读取设置统一超时信号
  }
  if (providerConfig.protocol === 'openai-responses') {             // 显式协议决定模型端点，不再依赖名称猜测
    const provider = createOpenAI({                                 // 创建支持 OpenAI Responses 协议的中转客户端
      ...providerOptions,                                           // 应用认证、地址、请求头和超时设置
    })
    return provider.responses(modelName)                            // 明确选择 /responses，不能回退到 Chat Completions
  }

  const provider = createOpenAICompatible({                         // 根据配置即时创建 OpenAI-compatible 客户端
    ...providerOptions,                                             // 应用认证、地址、请求头和超时设置
    includeUsage: true,                                             // 流式结束事件包含缓存读取和 token 用量
  })
  return provider(modelName)                                        // 返回当前模型，供本轮 Agent 调用
}


// --- 创建当前会话的提供商请求选项 ---
function getProviderOptions(sessionID) {
  const providerName = configStore.value.activeProvider            // 读取与当前模型相同的提供商名称
  const providerConfig = configStore.value.providers[providerName] // 读取提供商缓存能力开关
  if (providerConfig?.protocol !== 'openai-responses') return undefined // 未配置或 compatible 协议不注入 Responses 专属字段

  const openai = { store: false }                                   // Responses 调用始终保持无状态，不依赖上游保存 item
  if (providerConfig.cache?.enabled) {                              // 迁移完成后只读取新开关，关闭动作必须真实生效
    openai.promptCacheKey = sessionID                               // 同一会话使用稳定缓存键
    openai.promptCacheOptions = { mode: providerConfig.cache?.mode ?? 'implicit' } // 使用配置的缓存边界模式
  }
  return { openai }                                                  // 返回 AI SDK 的 OpenAI 专属请求选项
}


// --- 读取当前模型生成设置 ---
function getGenerationOptions() {
  const provider = configStore.value.providers[configStore.value.activeProvider] // 读取当前供应商的模型设置集合
  const settings = provider?.modelSettings?.[configStore.value.activeModel] ?? provider?.modelSettings ?? {} // 兼容按模型和单模型直接设置
  return {
    ...(Number.isFinite(settings.maxOutputTokens) ? { maxOutputTokens: settings.maxOutputTokens } : {}), // 只传递明确设置的输出上限
    ...(Number.isFinite(settings.temperature) ? { temperature: settings.temperature } : {}), // 只传递明确设置的采样温度
  }
}


// --- 读取当前模型上下文限制 ---
function getContextLimit() {
  const modelName = configStore.value.activeModel                  // 限制随当前模型即时切换
  const provider = configStore.value.providers[configStore.value.activeProvider] // 读取新供应商模型设置
  const settings = provider?.modelSettings?.[modelName] ?? provider?.modelSettings ?? {} // 兼容按模型和单模型直接设置
  return settings.context ?? configStore.value.modelLimits[modelName]?.context ?? 128000 // 新设置优先，旧限制继续兼容
}


// --- 永久允许一个工具 ---
async function allowTool(toolName) {
  configStore.value.permissions[toolName] = 'allow'                  // 将工具级权限改为直接允许
  await save()                                                       // 工具执行前保证选择已经持久化
  return { ok: true }                                                // 向审批指令反馈写盘完成
}


// --- 测试已保存供应商 ---
async function testProvider(providerName, modelName) {
  const provider = configStore.value.providers[providerName]        // 只允许测试已经保存的供应商记录
  if (!provider) return { ok: false, status: 404, error: 'provider not found' } // 未保存名称不能携带临时密钥调用
  const selectedModel = modelName ?? provider.models?.[0]           // 未指定时使用供应商列表中的第一个模型
  if (!selectedModel) return { ok: false, status: 400, error: 'model must be specified' } // 没有模型时无法发起测试

  try {
    const startedAt = Date.now()                                     // 记录完整请求往返时间供设置页判断连接质量
    await generateText({ model: createModel(providerName, selectedModel), prompt: 'Reply with OK.', maxOutputTokens: 16, providerOptions: provider.protocol === 'openai-responses' ? { openai: { store: false } } : undefined }) // 用兼容常见最小输出限制的请求验证认证、地址和协议
    return { ok: true, provider: providerName, model: selectedModel, latencyMs: Date.now() - startedAt } // 反馈真实模型和延迟
  } catch (error) {
    return { ok: false, status: 502, error: `provider test failed: ${error.message}` } // 隐藏请求配置，仅反馈上游错误
  }
}


// --- 统一供应商记录 ---
function normalizeProviders(providers) {
  for (const [name, provider] of Object.entries(providers ?? {})) {
    if (!provider || typeof provider !== 'object') continue          // 无效记录留给模型创建时报出配置错误
    if (!['openai-responses', 'openai-compatible'].includes(provider.protocol)) { // 缺失或无效协议需要迁移为两个支持值之一
      const hasGPTModel = provider.models?.some?.((model) => model.startsWith('gpt-')) // 复用旧逻辑识别 Responses 模型族
      provider.protocol = name.toLowerCase().endsWith('openai') && hasGPTModel ? 'openai-responses' : 'openai-compatible' // 保持旧记录原有端点选择
    }
    provider.headers = provider.headers && typeof provider.headers === 'object' ? provider.headers : {} // 自定义请求头统一为对象
    provider.timeoutMs = Number.isFinite(provider.timeoutMs) && provider.timeoutMs > 0 ? provider.timeoutMs : 120000 // 缺省请求最长等待两分钟
    const cache = provider.cache && typeof provider.cache === 'object' ? provider.cache : {} // 接受已有显式缓存对象
    provider.cache = { enabled: cache.enabled ?? Boolean(provider.setCacheKey), mode: cache.mode ?? 'implicit' } // 旧 setCacheKey 继续决定迁移后的默认值
    provider.modelSettings = provider.modelSettings && typeof provider.modelSettings === 'object' ? provider.modelSettings : {} // 模型生成设置统一为对象
  }
}


// --- 创建带超时的请求函数 ---
function createTimeoutFetch(timeoutMs) {
  return (input, init = {}) => {                                    // 保持 AI SDK 传入的完整 fetch 参数
    const timeoutSignal = AbortSignal.timeout(timeoutMs)             // 超时覆盖响应流读取而不只覆盖建连
    const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal // 用户停止和超时任一发生都中断请求
    return fetch(input, { ...init, signal })                          // 使用 Bun 原生 fetch 执行真实上游请求
  }
}


export const Config = { load, save, get, update, allowTool, testProvider, createModel, getActiveModel, getProviderOptions, getGenerationOptions, getContextLimit } // 导出全部配置业务动作
