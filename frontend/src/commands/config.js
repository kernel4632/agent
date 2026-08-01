/*
配置指令：读取 Server 配置、工具和外部能力，并转换为设置页可编辑结构。
脱敏密钥原样保留到保存请求，Server 会恢复真实值；运行状态不会混入持久化配置。
调用示例：await Config.load()、await Config.testConnection('aker', 'glm-5.2')。
*/
import { AgentAPI } from '../api.js'                    // 引入配置、工具和能力 HTTP 契约
import { store } from '../store.js'                     // 引入全局配置与 Agent 目录


// --- 加载完整设置数据 ---
async function load() {
  try {
    const [raw, tools, capabilities, agents] = await Promise.all([ // 并行读取互不依赖的 Server 资源
      AgentAPI.getConfig(),                               // 读取脱敏持久化配置
      AgentAPI.listTools(),                               // 读取统一工具目录
      AgentAPI.listCapabilities(),                        // 读取 MCP、LSP 和 Skill 运行状态
      AgentAPI.listAgents(),                              // 读取会话模型目录
    ])
    store.agents.splice(0, store.agents.length, ...agents) // 保留响应式 Agent 数组身份
    apply(raw, tools, capabilities)                       // 将 Server 数据转换为设置页面结构
    return true                                           // 反馈应用启动可以继续
  } catch (error) {
    store.ui.errorMessage = error.message                 // 页面展示真实连接或协议错误
    return false                                          // 不制造假配置
  }
}


// --- 应用 Server 配置到设置结构 ---
function apply(raw, tools = store.config.tools, capabilities = { mcp: [] }) {
  const providers = Object.fromEntries(Object.entries(raw.providers ?? {}).map(([name, provider]) => [name, {
    ...provider,                                          // 保留协议、缓存和模型设置
    enabled: provider.enabled !== false,                  // 设置页开关默认为启用
    timeout: provider.timeoutMs ?? 120000,                // 适配现有数字输入字段
    headers: JSON.stringify(provider.headers ?? {}, null, 2), // 设置页使用可编辑 JSON 文本
  }]))
  const toolSettings = tools.map((tool) => ({
    ...tool,                                              // 保留名称、来源和可读标签
    title: tool.label || tool.name,                       // 展示 Server 工具别名
    enabled: true,                                        // 已注册工具即为启用
    permission: raw.permissions?.[tool.name] ?? 'ask',     // 权限来自持久配置
  }))
  const mcpStatus = Object.fromEntries((capabilities.mcp ?? []).map((server) => [server.name, server])) // 名称映射到真实运行状态
  const mcp = Object.entries(raw.mcpServers ?? {}).map(([name, definition]) => ({
    id: name,                                             // 设置页使用稳定配置键作为身份
    name,                                                 // 展示和保存共用名称
    command: definition.command || definition.url || '',  // 简单面板显示主要连接地址
    enabled: definition.enabled !== false,                // 映射启用开关
    status: mcpStatus[name]?.status || 'stopped',          // 运行状态来自 capability API
    toolCount: mcpStatus[name]?.toolCount || 0,            // 展示已发现工具数量
    definition: structuredClone(definition),              // 保存完整 transport/args/env/headers 定义
  }))

  Object.assign(store.config, {
    providers,                                            // 替换供应商编辑目录
    tools: toolSettings,                                  // 替换工具权限目录
    mcp,                                                  // 替换 MCP 编辑和状态目录
    prompt: raw.systemPrompt || '',                       // 适配提示词编辑字段
    appearance: store.config.appearance,                  // 外观偏好保持前端本地状态
    activeProvider: raw.activeProvider || '',             // 保存当前供应商选择
    activeModel: raw.activeModel || '',                   // 保存当前模型选择
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
