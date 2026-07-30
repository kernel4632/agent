/*
配置指令集：加载、读取、更新配置，并按当前选择创建真实模型。
配置只在此处读写磁盘，store/config.js 仅保存当前值和文件位置。
调用示例：await Config.load('C:/Users/me/.agent/config.json')、Config.getActiveModel()。
*/
import { mkdir } from 'node:fs/promises'                          // 引入创建配置目录的文件能力
import { dirname } from 'node:path'                               // 引入提取配置父目录的路径能力
import { createOpenAICompatible } from '@ai-sdk/openai-compatible' // 引入 OpenAI-compatible 模型提供商
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
      const savedKey = configStore.value.providers?.[name]?.apiKey // 读取同名提供商未脱敏的真实密钥
      if (provider.apiKey === '[REDACTED]') provider.apiKey = savedKey // 未修改的脱敏占位符恢复为真实密钥
    }
  }

  configStore.value = defu(nextChanges, configStore.value)         // 普通局部字段继续深度保留未修改内容
  if ('providers' in nextChanges) configStore.value.providers = nextChanges.providers // 提供商集合按 UI 完整结果替换，删除才能生效
  await save()                                                      // 写盘完成后才向 API 反馈成功
  return { ok: true }                                               // 返回统一成功结果
}


// --- 创建当前真实模型 ---
function getActiveModel() {
  const providerName = configStore.value.activeProvider            // 每次调用都读取最新供应商选择
  const modelName = configStore.value.activeModel                  // 每次调用都读取最新模型选择
  const providerConfig = configStore.value.providers[providerName] // 从当前供应商读取密钥与接口地址
  if (!providerConfig || !modelName) {                              // 缺少真实调用参数时给出明确配置错误
    throw new Error('active provider and model must be configured')
  }

  const provider = createOpenAICompatible({                         // 根据配置即时创建 OpenAI-compatible 客户端
    name: providerName,                                             // 保留提供商名称用于请求元数据识别
    apiKey: providerConfig.apiKey,                                  // 密钥只在内存中交给提供商，不写日志
    baseURL: providerConfig.baseURL,                                // 使用配置中的真实 API 地址
  })
  return provider(modelName)                                        // 返回当前模型，供本轮 Agent 调用
}


// --- 读取当前模型上下文限制 ---
function getContextLimit() {
  const modelName = configStore.value.activeModel                  // 限制随当前模型即时切换
  return configStore.value.modelLimits[modelName]?.context ?? 128000 // 未声明时使用保守默认上下文
}


export const Config = { load, save, get, update, getActiveModel, getContextLimit } // 导出全部配置业务动作
