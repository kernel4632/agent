/*
Agent 定义指令：管理模型选择和提示词配置，不复制全局权限、工具、MCP、LSP、Skill 或工作区。
AgentDefinition 是静态选择；每个 Run 创建时读取它并固定快照，避免运行中切换全局配置影响当前任务。
调用示例：await Agent.load()、Agent.resolve('default')、Agent.list()。
*/
import { Config } from './config.js'                   // 引入持久配置和默认 Agent 迁移
import { store } from '../store.js'                    // 引入 Agent 定义运行状态


// --- 从当前配置加载 Agent 定义 ---
async function load() {
  const config = Config.get()                          // 读取已经归一化的完整配置副本
  store.agents.definitions.clear()                     // 重载只保留最新定义
  for (const [id, definition] of Object.entries(config.agents ?? {})) {
    store.agents.definitions.set(id, {                  // Agent 只保存模型选择，不复制共享环境
      id,
      name: definition.name || id,
      provider: definition.provider || config.activeProvider,
      model: definition.model || config.activeModel,
      systemPrompt: definition.systemPrompt || config.systemPrompt,
    })
  }
  for (const [provider, providerConfig] of Object.entries(config.providers ?? {})) {
    for (const model of providerConfig.models ?? []) {
      const id = `${provider}:${model}`                         // 未单独配置的模型仍需要一个可选择 Agent 身份
      if (store.agents.definitions.has(id)) continue             // 用户自定义 Agent 优先保留自己的提示词
      store.agents.definitions.set(id, { id, name: model, provider, model, systemPrompt: config.systemPrompt }) // 将设置页模型目录接入正式 Run 解析
    }
  }
  return list()                                        // 返回可展示的 Agent 目录
}


// --- 列出 Agent 定义 ---
function list() {
  return [...store.agents.definitions.values()].map((definition) => ({ ...definition })) // 返回副本，阻止路由修改运行状态
}


// --- 读取一个 Agent 定义 ---
function get(agentID) {
  const definition = store.agents.definitions.get(agentID) // 按显式 ID 查找模型选择
  return definition ? { ...definition } : null            // 不存在时返回空值供路由反馈 404
}


// --- 解析一个 Run 使用的 Agent 快照 ---
function resolve(agentID) {
  const selectedID = agentID || Config.get().defaultAgentId || 'default' // 未指定时使用配置默认 Agent
  const definition = get(selectedID) || get('default')                 // 旧配置迁移后始终保留 default
  if (!definition) throw new Error(`agent not found: ${selectedID}`)    // 没有可用 Agent 时立即拒绝启动
  return structuredClone(definition)                                   // Run 使用不可变快照
}


// --- 保存一个 Agent 定义 ---
async function save(agentID, changes) {
  const id = agentID || `agent_${Date.now()}`                    // 新 Agent 使用稳定可读的 ID
  const config = Config.get()                                    // 读取完整配置以保留其他 Agent
  const current = config.agents?.[id] || {}                      // 同名更新只替换当前定义
  const agents = {
    ...(config.agents || {}),
    [id]: {
      ...current,
      id,
      name: changes.name,
      provider: changes.provider,
      model: changes.model,
      systemPrompt: changes.systemPrompt ?? current.systemPrompt ?? config.systemPrompt,
    },
  }
  await Config.update({ agents })                                 // 复用配置校验、持久化和脱敏流程
  await load()                                                     // 让下一次 Run 立即看到最新定义
  return get(id)                                                   // 返回脱敏后的当前 Agent 定义
}


export const Agent = { load, list, get, resolve, save }                  // 暴露 Agent 目录、快照和保存指令
