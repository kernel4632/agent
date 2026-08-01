/*
配置指令集：加载、读取、更新配置，并按当前选择创建真实模型。
配置只在此处读写磁盘，store.js 仅保存当前值和文件位置。
调用示例：await Config.load('C:/Users/me/.agent/config.json')、Config.getActiveModel()。
*/
import { mkdir, readdir } from 'node:fs/promises'                 // 引入创建配置目录和工具扫描能力
import { dirname, join, resolve } from 'node:path'                // 引入路径和工具目录定位能力
import { pathToFileURL } from 'node:url'
import chokidar from 'chokidar'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { createOpenAI } from '@ai-sdk/openai'                     // 引入支持 Responses API 缓存的 OpenAI 提供商
import { createOpenAICompatible } from '@ai-sdk/openai-compatible' // 引入 OpenAI-compatible 模型提供商
import { generateText } from 'ai'                                  // 引入供应商连通性测试所需的最小生成调用
import { defu } from 'defu'                                      // 引入配置深度合并能力
import { store } from '../store.js'                                // 引入服务端唯一状态根

const configStore = store.config                                      // 当前指令使用配置领域状态
const toolStore = store.tools
const capabilityStore = store.capabilities

const defaultConfig = {                                          // 首次运行时写入的可编辑默认配置
  activeProvider: '',                                             // 未配置供应商时不猜测用户选择
  activeModel: '',                                                // 未配置模型时保持为空
  providers: {},                                                  // 供应商由用户或配置 API 添加
  systemPrompt: '你是一个有用的 AI 助手，能够通过调用工具帮助用户完成任务。', // 每轮模型调用使用的系统指令
  permissions: {},                                                // 未声明工具按 ask 处理
  modelLimits: {},                                                // 模型上下文限制按模型名称保存
  runTimeoutMs: 300000,                                           // 单次根或子 Run 默认最多执行五分钟
  mcpServers: {},                                                 // MCP 服务按名称保存 stdio 或 HTTP 声明
                                                                    // 外部能力只保留 MCP 与 Skills
  skills: { enabled: true, directories: [], disabled: [] },       // Skill 默认扫描用户和项目目录
}


// --- 加载磁盘配置 ---
async function load(filePath, mcpFilePath = `${dirname(filePath)}/mcp.json`) {
  configStore.filePath = filePath                                 // 记录后续保存使用的同一配置路径
  configStore.mcpFilePath = mcpFilePath                           // 记录独立 MCP 配置路径
  await mkdir(dirname(filePath), { recursive: true })              // 确保首次运行时配置目录存在

  const file = Bun.file(filePath)                                 // 从传入路径定位用户配置文件
  const savedConfig = await file.exists() ? await file.json() : {} // 文件不存在时从默认配置开始
  const mcpFile = Bun.file(mcpFilePath)                            // 定位独立 MCP 配置文件
  const savedMCPDocument = await mcpFile.exists() ? await mcpFile.json() : null // 优先读取已经迁移的独立定义
  const savedMCPServers = savedMCPDocument?.mcpServers ?? savedConfig.mcpServers ?? {} // 首次启动兼容旧 config.json
  delete savedConfig.mcpServers                                   // 主配置不再持久化 MCP 定义
  const configDefaults = structuredClone(defaultConfig)           // 建立不含 MCP 的主配置默认值
  delete configDefaults.mcpServers                                 // 避免默认字段重新写回 config.json
  configStore.sourceValue = defu(savedConfig, configDefaults)      // 保存磁盘原文结构，环境密钥继续保留占位符
  configStore.mcpSourceValue = { mcpServers: structuredClone(savedMCPServers) } // 保存 mcp.json 原文结构
  configStore.value = structuredClone(configStore.sourceValue)      // 运行态副本允许展开环境变量
  configStore.value.mcpServers = structuredClone(savedMCPServers)   // API 和运行时继续消费统一配置视图
  resolveEnvironmentSecrets(configStore.value)                     // 运行时展开环境占位符，磁盘继续保存占位符
  normalizeProviders(configStore.value.providers)                  // 将旧供应商记录升级为显式协议和请求设置
  normalizeCapabilities(configStore.value)                         // 补齐外部能力默认结构
  await save()                                                     // 将补齐后的完整结构同步到磁盘
  return configStore.value                                        // 向启动流程反馈当前配置
}


// --- 保存当前配置 ---
async function save(value = configStore.value) {
  if (!value || !configStore.filePath) {                            // 尚未加载时拒绝产生位置不明的文件
    throw new Error('configuration has not been loaded')
  }

  const persisted = restoreEnvironmentSecrets(value, { ...configStore.sourceValue, mcpServers: configStore.mcpSourceValue?.mcpServers }) // 保存前恢复全部环境占位符
  const { mcpServers, ...mainConfig } = persisted                    // MCP 定义只写入独立文件
  await Promise.all([
    Bun.write(configStore.filePath, `${JSON.stringify(mainConfig, null, 2)}\n`), // 写入不含 MCP 的主配置
    Bun.write(configStore.mcpFilePath, `${JSON.stringify({ mcpServers: mcpServers || {} }, null, 2)}\n`), // 写入独立 MCP 配置
  ])
  configStore.sourceValue = structuredClone(mainConfig)             // 两个文件都成功后才推进环境占位符基线
  configStore.mcpSourceValue = { mcpServers: structuredClone(mcpServers || {}) } // 写入失败时保留原基线和运行态
}


// --- 读取完整配置 ---
function get() {
  return structuredClone(configStore.value)                        // 返回副本，防止路由绕过 update 修改状态
}


// --- 读取可公开的设计配置 ---
function getPublic() {
  const config = get()                                               // 从运行态创建独立公开副本
  for (const provider of Object.values(config.providers ?? {})) {
    if (provider && 'apiKey' in provider) provider.apiKey = provider.apiKey ? '[REDACTED]' : provider.apiKey // API Key 只反馈是否存在
    for (const header of Object.keys(provider?.headers ?? {})) {
      if (/authorization|api[-_]?key|token|cookie|secret/i.test(header) && provider.headers[header]) provider.headers[header] = '[REDACTED]' // 认证请求头不返回明文
    }
  }
  for (const server of Object.values(config.mcpServers ?? {})) {
    for (const field of ['headers', 'env']) {
      for (const key of Object.keys(server?.[field] ?? {})) {
        if (/authorization|api[-_]?key|token|cookie|secret|password/i.test(key) && server[field][key]) server[field][key] = '[REDACTED]' // MCP 密钥使用同一规则
      }
    }
  }
  config.provider = structuredClone(config.providers)               // 公开设计规定的供应商字段
  config.tools = structuredClone(config.permissions)                 // 公开设计规定的工具配置字段
  config.defaultModel = config.activeModel                           // 公开设计规定的默认模型字段
  return config                                                       // 反馈安全且符合设计的数据结构
}


// --- 合并配置更新 ---
async function update(changes) {
  const nextChanges = structuredClone(changes)                     // 复制请求，避免密钥修复修改路由输入
  if ('provider' in nextChanges && !('providers' in nextChanges)) nextChanges.providers = nextChanges.provider // 设计字段映射到内部供应商集合
  if ('tools' in nextChanges && !('permissions' in nextChanges)) nextChanges.permissions = nextChanges.tools // 设计字段映射到工具权限
  if ('defaultModel' in nextChanges && !('activeModel' in nextChanges)) nextChanges.activeModel = nextChanges.defaultModel // 设计默认模型映射到运行选择
  delete nextChanges.provider                                      // 兼容别名不写入内部配置文件
  delete nextChanges.tools                                         // 工具别名不形成第二份状态
  delete nextChanges.defaultModel                                  // 模型别名不形成第二份状态
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
  if (nextChanges.mcpServers) restoreCapabilitySecrets(nextChanges.mcpServers, configStore.value.mcpServers) // 恢复 MCP 敏感环境变量和请求头

  const nextValue = defu(nextChanges, configStore.value)            // 在独立候选值中深度保留未修改内容
  if ('providers' in nextChanges) nextValue.providers = nextChanges.providers // 提供商集合按 UI 完整结果替换，删除才能生效
  if ('mcpServers' in nextChanges) nextValue.mcpServers = nextChanges.mcpServers // MCP 集合完整替换才能删除服务
  if ('skills' in nextChanges) nextValue.skills = nextChanges.skills             // Skill 配置按页面完整结果替换
  normalizeProviders(nextValue.providers)                           // 新旧 API 输入统一为完整供应商结构
  normalizeCapabilities(nextValue)                                  // 新旧外部能力输入统一默认值
  await save(nextValue)                                              // 候选值完整写盘后才替换运行态
  configStore.value = nextValue                                      // 保存失败不能让模型看到未持久化配置
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
  return getProviderOptionsFor(configStore.value.activeProvider, sessionID) // 旧调用继续使用全局当前提供商
}


// --- 创建指定 Agent 的提供商请求选项 ---
function getProviderOptionsFor(providerName, sessionID) {
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
  return getGenerationOptionsFor(configStore.value.activeProvider, configStore.value.activeModel) // 旧调用继续使用全局当前模型
}


// --- 读取指定 Agent 的模型生成设置 ---
function getGenerationOptionsFor(providerName, modelName) {
  const provider = configStore.value.providers[providerName] // 读取指定供应商的模型设置集合
  const settings = provider?.modelSettings?.[modelName] ?? provider?.modelSettings ?? {} // 兼容按模型和单模型直接设置
  return {
    ...(Number.isFinite(settings.maxOutputTokens) ? { maxOutputTokens: settings.maxOutputTokens } : {}), // 只传递明确设置的输出上限
    ...(Number.isFinite(settings.temperature) ? { temperature: settings.temperature } : {}), // 只传递明确设置的采样温度
  }
}


// --- 读取当前模型上下文限制 ---
function getContextLimit() {
  return getContextLimitFor(configStore.value.activeProvider, configStore.value.activeModel) // 旧调用继续使用全局当前模型
}


// --- 读取指定 Agent 的上下文限制 ---
function getContextLimitFor(providerName, modelName) {
  const provider = configStore.value.providers[providerName] // 读取指定供应商模型设置
  const settings = provider?.modelSettings?.[modelName] ?? provider?.modelSettings ?? {} // 兼容按模型和单模型直接设置
  return settings.context ?? configStore.value.modelLimits[modelName]?.context ?? 128000 // 新设置优先，旧限制继续兼容
}


// --- 永久允许一个工具 ---
async function allowTool(toolName) {
  const nextValue = structuredClone(configStore.value)               // 永久审批先创建独立候选配置
  nextValue.permissions[toolName] = 'allow'                           // 将工具级权限改为直接允许
  await save(nextValue)                                               // 工具执行前保证选择已经持久化
  configStore.value = nextValue                                       // 保存成功后再让后续工具读取新权限
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


// --- 从已保存供应商读取模型目录 ---
async function listModels(providerName) {
  const provider = configStore.value.providers[providerName] // 只允许使用已保存认证请求上游模型目录
  if (!provider) return { ok: false, status: 404, error: 'provider not found' } // 未保存供应商不能执行发现
  const baseURL = String(provider.baseURL || '').replace(/\/$/, '') // 去掉尾部斜杠避免形成双斜杠路径
  if (!baseURL) return { ok: false, status: 400, error: 'provider baseURL is empty' } // 没有地址无法发现模型
  try {
    const response = await fetch(`${baseURL}/models`, { headers: { Authorization: `Bearer ${provider.apiKey}`, ...(provider.headers || {}) }, signal: AbortSignal.timeout(provider.timeoutMs) }) // 通过真实 OpenAI-compatible models 接口读取目录
    if (!response.ok) return { ok: false, status: 502, error: `model discovery failed with status ${response.status}` } // 上游失败转换为网关错误
    const payload = await response.json()                  // 读取供应商返回的模型集合
    const models = Array.isArray(payload.data) ? payload.data.map((item) => item.id).filter((id) => typeof id === 'string') : [] // 兼容 OpenAI models 数据结构
    return { ok: true, provider: providerName, models }      // 返回设置页可选择的真实模型 ID
  } catch (error) {
    return { ok: false, status: 502, error: `model discovery failed: ${error.message}` } // 隐藏认证细节，只反馈连接失败
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


// --- 恢复外部能力中的脱敏配置 ---
function restoreCapabilitySecrets(nextServers, savedServers = {}) {
  for (const [name, definition] of Object.entries(nextServers)) {
    const saved = savedServers?.[name] || {}                                      // 同名服务才允许恢复原认证值
    for (const field of ['headers', 'env']) {
      for (const [key, value] of Object.entries(definition[field] || {})) {
        if (value === '[REDACTED]') definition[field][key] = saved[field]?.[key]    // 未编辑占位符不能覆盖真实值
      }
    }
  }
}


// --- 展开运行时环境密钥 ---
function resolveEnvironmentSecrets(config) {
  const resolveValue = (value) => {
    if (typeof value === 'string') return value.replace(/\$\{([A-Z0-9_]+)\}/g, (match, name) => process.env[name] ?? match) // 只展开明确的大写环境变量占位符
    if (Array.isArray(value)) return value.map(resolveValue)             // 数组中的请求参数也支持环境引用
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveValue(item)])) // 递归处理供应商与能力定义
    return value                                                           // 数字、布尔和空值保持原样
  }
  for (const [name, provider] of Object.entries(config.providers ?? {})) config.providers[name] = resolveValue(provider) // 展开 API Key、请求头和模型地址
  for (const [name, server] of Object.entries(config.mcpServers ?? {})) config.mcpServers[name] = resolveValue(server) // 展开 MCP 子进程环境和认证头
}


// --- 保存前恢复环境占位符 ---
function restoreEnvironmentSecrets(value, source) {
  if (typeof source === 'string' && /^\$\{[A-Z0-9_]+\}$/.test(source) && process.env[source.slice(2, -1)] === value) return source // 未被编辑的环境值继续以占位符写盘
  if (Array.isArray(value)) return value.map((item, index) => restoreEnvironmentSecrets(item, source?.[index])) // 递归恢复数组字段
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restoreEnvironmentSecrets(item, source?.[key])])) // 递归恢复配置对象
  return value                                                               // 非环境字段保持运行态值
}


// --- 统一 MCP 与 Skill 配置 ---
function normalizeCapabilities(config) {
  config.mcpServers = config.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {} // MCP 声明统一为对象
  for (const definition of Object.values(config.mcpServers)) {
    definition.transport = definition.transport === 'http' ? 'http' : 'stdio'       // 只接受两个官方传输类型
    definition.args = Array.isArray(definition.args) ? definition.args : []         // stdio 参数统一为数组
    definition.headers = definition.headers && typeof definition.headers === 'object' ? definition.headers : {} // HTTP 头统一为对象
    definition.env = definition.env && typeof definition.env === 'object' ? definition.env : {} // 子进程环境统一为对象
  }
  const skills = config.skills && typeof config.skills === 'object' ? config.skills : {} // 接受旧配置缺失 Skill 字段
  config.skills = { enabled: skills.enabled !== false, directories: Array.isArray(skills.directories) ? skills.directories.flat(Infinity).filter((directory) => typeof directory === 'string') : [], disabled: Array.isArray(skills.disabled) ? skills.disabled.flat(Infinity).filter((name) => typeof name === 'string') : [] } // 保存稳定完整结构
}


// --- 创建带超时的请求函数 ---
function createTimeoutFetch(timeoutMs) {
  return (input, init = {}) => {                                    // 保持 AI SDK 传入的完整 fetch 参数
    const timeoutSignal = AbortSignal.timeout(timeoutMs)             // 超时覆盖响应流读取而不只覆盖建连
    const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal // 用户停止和超时任一发生都中断请求
    return fetch(input, { ...init, signal })                          // 使用 Bun 原生 fetch 执行真实上游请求
  }
}

// --- 工具目录加载与热重载 ---
async function loadToolFile(filePath) {
  const absolutePath = resolve(filePath)
  for (const [name, item] of toolStore.items) if (item.filePath === absolutePath) toolStore.items.delete(name)
  const module = await import(`${pathToFileURL(absolutePath).href}?updated=${Date.now()}`)
  for (const [name, definition] of Object.entries(module)) if (definition?.description && typeof definition.execute === 'function') toolStore.items.set(name, { ...definition, name, filePath: absolutePath, source: absolutePath.includes(`${join('tools', 'custom')}${process.platform === 'win32' ? '\\' : '/'}`) ? 'custom' : 'built-in' })
}
async function loadTools(directories) {
  toolStore.directories = directories.map((directory) => resolve(directory)); const errors = []; const files = []
  for (const directory of toolStore.directories) { try { files.push(...(await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.js')).map((entry) => join(directory, entry.name))) } catch (error) { if (error.code !== 'ENOENT') throw error } }
  for (const file of files) try { await loadToolFile(file) } catch (error) { errors.push({ file, error: String(error) }) }
  return { ok: true, loaded: toolStore.items.size, files: files.length, errors }
}
async function watchTools() {
  if (toolStore.watcher) return
  toolStore.watcher = chokidar.watch(toolStore.directories.map((directory) => join(directory, '*.js')), { ignoreInitial: true })
  toolStore.watcher.on('add', (path) => loadToolFile(path).catch(() => {})).on('change', (path) => loadToolFile(path).catch(() => {})).on('unlink', (path) => { const filePath = resolve(path); for (const [name, item] of toolStore.items) if (item.filePath === filePath) toolStore.items.delete(name) })
}
async function closeTools() { if (toolStore.watcher) { await toolStore.watcher.close(); toolStore.watcher = null } }

// --- MCP 连接生命周期 ---
function removeMCPTools(server) { for (const [name, item] of toolStore.items) if (item.kind === 'mcp' && item.server === server) toolStore.items.delete(name) }
async function connectMCP(name, definition) {
  const runtime = { name, status: 'connecting', error: '', toolCount: 0, transport: definition.transport || 'stdio' }; capabilityStore.mcp.set(name, runtime)
  if (definition.enabled === false) { runtime.status = 'disabled'; return runtime }
  try {
    const client = new Client({ name: 'agent-workbench', version: '0.1.0' }); const transport = runtime.transport === 'http' ? new StreamableHTTPClientTransport(new URL(definition.url), { requestInit: { headers: definition.headers || {} } }) : new StdioClientTransport({ command: definition.command, args: definition.args || [], cwd: definition.cwd || capabilityStore.workspaceDirectory, env: { ...process.env, ...(definition.env || {}) }, stderr: 'pipe' })
    runtime.client = client; await client.connect(transport); const response = await client.listTools(); runtime.status = 'connected'; runtime.toolCount = response.tools.length
    for (const remote of response.tools) { const toolName = `mcp_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${remote.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`; toolStore.items.set(toolName, { name: toolName, label: remote.title || remote.name, description: remote.description || `MCP ${name} ${remote.name}`, inputSchema: remote.inputSchema || { type: 'object', properties: {} }, source: `mcp:${name}`, kind: 'mcp', server: name, originalName: remote.name, execute: (input, context = {}) => client.callTool({ name: remote.name, arguments: input }, CallToolResultSchema, { signal: context.abortSignal }) }) }
  } catch (error) { runtime.status = 'error'; runtime.error = error.message; removeMCPTools(name) }
  return runtime
}
async function closeMCP() { await Promise.all([...capabilityStore.mcp.values()].map(async (runtime) => { try { await runtime.client?.close() } catch {} })); for (const name of capabilityStore.mcp.keys()) removeMCPTools(name); capabilityStore.mcp.clear() }
async function reloadMCP() { await closeMCP(); await Promise.all(Object.entries(configStore.value.mcpServers || {}).map(([name, definition]) => connectMCP(name, definition))); return { ok: true, servers: listMCP() } }
function listMCP() { return Object.entries(configStore.value.mcpServers || {}).map(([name, definition]) => { const runtime = capabilityStore.mcp.get(name); return { name, transport: definition.transport || 'stdio', enabled: definition.enabled !== false, status: runtime?.status || 'configured', error: runtime?.error || '', toolCount: runtime?.toolCount || 0, updatedAt: runtime?.updatedAt || '' } }) }


export const Config = { load, save, get, getPublic, update, allowTool, testProvider, listModels, createModel, getActiveModel, getProviderOptions, getProviderOptionsFor, getGenerationOptions, getGenerationOptionsFor, getContextLimit, getContextLimitFor, loadTools, watchTools, closeTools, reloadMCP, closeMCP, listMCP } // 导出配置与能力动作
