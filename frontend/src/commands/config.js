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
  const providerData = raw.provider ?? {}                  // 读取 Server 唯一供应商配置
  const providers = {
    默认供应商: {
      enabled: true,                                        // 设置页开关默认为启用
      protocol: 'openai-compatible',                        // 当前 Server 固定使用 OpenAI 兼容协议
      baseURL: providerData.api || '',                      // API 地址
      apiKey: providerData.key || '',                       // API 密钥
      models: Array.isArray(providerData.models) ? providerData.models : [], // 可用模型列表
      modelSettings: {},                                    // 前端维护模型能力设置
      timeout: 120000,                                      // 默认请求超时
      headers: '{}',                                        // 自定义请求头
    },
  }
  const permissions = raw.permission ?? {}
  const toolSettings = Object.entries(permissions)
    .filter(([name]) => !['delegate_task', 'agent'].includes(name))
    .map(([name, permission]) => ({ name, title: name, enabled: permission !== 'deny', permission }))
  const mcp = Object.entries(raw.mcp ?? {}).map(([name, definition]) => ({
    id: name,                                               // 设置页使用稳定配置键作为身份
    name,                                                   // 展示和保存共用名称
    command: definition.command || definition.url || '',     // 简单面板显示主要连接地址
    enabled: definition.enabled !== false,                   // 映射启用开关
    definition: structuredClone(definition),                 // 保存完整 transport/args/env/headers 定义
  }))

  Object.assign(store.config, {
    providers,                                              // 替换供应商编辑目录
    tools: toolSettings,                                    // 替换工具权限目录
    mcp,                                                    // 替换 MCP 编辑和状态目录
    prompt: raw.prompts?.system || '',                       // 读取 Server 系统提示词
    appearance: store.config.appearance,                     // 外观偏好保持前端本地状态
    activeProvider: '默认供应商',                             // Server 当前只有一个供应商
    activeModel: providerData.models?.[0] || '',             // 使用模型列表首项作为默认
    raw: structuredClone(raw),                               // 保留未在设置页展示的字段
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
