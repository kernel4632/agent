/*
Agent 前端指令：读取 Server 的模型选择目录，并把结果写入全局 Agent 状态。
权限、工具、MCP、LSP、Skills 和工作区仍由 Server 全局共享，不在前端复制。
调用示例：await Agent.refresh()。
*/
import { AgentAPI } from '../api.js'                         // 引入 Agent 目录 HTTP 指令
import { store } from '../store.js'                          // 引入全局 Agent 状态


// --- 刷新 Agent 目录 ---
async function refresh() {
  store.agents.isLoading = true                              // 进入目录读取反馈
  store.agents.errorMessage = ''                             // 清除旧错误
  try {
    store.agents.items = await AgentAPI.listAgents()          // 使用 Server 返回的最新定义
    return store.agents.items                                 // 返回目录供首次打开聊天选择默认值
  } catch (error) {
    store.agents.errorMessage = error.message                 // 保留设置页可展示错误
    return []                                                 // 失败时不阻塞聊天壳加载
  } finally {
    store.agents.isLoading = false                            // 结束目录读取反馈
  }
}


export const Agent = { refresh }                              // 暴露 Agent 目录读取指令
