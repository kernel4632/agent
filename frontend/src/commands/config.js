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
  const providerSource = raw.providers ?? raw.provider ?? {}
  const providers = Object.fromEntries(Object.entries(providerSource).map(([name, provider]) => [name, {
    ...provider,                                          // 保留协议、缓存和模型设置
    enabled: provider.enabled !== false,                  // 设置页开关默认为启用
    timeout: provider.timeoutMs ?? 120000,                // 适配现有数字输入字段
    headers: JSON.stringify(provider.headers ?? {}, null, 2), // 设置页使用可编辑 JSON 文本
  }]))
  const permissions = raw.permissions ?? raw.tools ?? {}
  const toolSettings = Object.entries(permissions)
    .filter(([name]) => !['delegate_task', 'agent'].includes(name))
    .map(([name, permission]) => ({ name, title: name, enabled: permission !== 'deny', permission }))
  const mcp = Object.entries(raw.mcpServers ?? {}).map(([name, definition]) => ({
    id: name,                                             // 设置页使用稳定配置键作为身份
    name,                                                 // 展示和保存共用名称
    command: definition.command || definition.url || '',  // 简单面板显示主要连接地址
    enabled: definition.enabled !== false,                // 映射启用开关
    definition: structuredClone(definition),              // 保存完整 transport/args/env/headers 定义
  }))

  Object.assign(store.config, {
    providers,                                            // 替换供应商编辑目录
    tools: toolSettings,                                  // 替换工具权限目录
    mcp,                                                  // 替换 MCP 编辑和状态目录
    prompt: raw.systemPrompt || '',                       // 适配提示词编辑字段
    appearance: store.config.appearance,                  // 外观偏好保持前端本地状态
    activeProvider: raw.activeProvider || Object.keys(providers)[0] || '', // 保存当前供应商选择
    activeModel: raw.activeModel || raw.defaultModel || '', // 保存当前模型选择
    raw: structuredClone(raw),                            // 保留未在设置页展示的字段
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
