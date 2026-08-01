/*
Agent HTTP 指令集：集中声明前端使用的正式 Server API 契约。
普通请求统一解析 JSON；会话事件保留原始 Response 交给 SSE 工具按顺序读取。
调用示例：await AgentAPI.listWorkspaces()、await AgentAPI.sendMessage(sessionID, content)。
*/
const apiRoot = '/api'                                  // Vite 与桌面宿主统一代理的 API 前缀


// --- 发送普通 JSON 请求 ---
async function request(path, method = 'GET', body) {
  const response = await fetch(`${apiRoot}${path}`, {   // 向真实 Agent Server 发起 HTTP 请求
    method,                                             // 使用业务动作指定方法
    headers: body === undefined ? undefined : { 'content-type': 'application/json' }, // 有请求体时声明 JSON
    body: body === undefined ? undefined : JSON.stringify(body), // 将结构化数据编码为请求正文
  })
  const data = await response.json()                    // 正式普通接口都返回 JSON
  if (!response.ok) {
    const error = new Error(data.error ?? `请求失败: ${response.status}`) // 将 HTTP 失败转换为可展示异常
    error.status = response.status                      // 保留状态码供冲突场景处理
    error.data = data                                   // 保留业务字段供界面反馈
    throw error
  }
  return data                                           // 返回对应指令的业务结果
}


// --- 建立会话事件订阅 ---
function subscribeSession(sessionID, afterID, signal) {
  return fetch(`${apiRoot}/session/events?sessionId=${encodeURIComponent(sessionID)}&afterId=${afterID || 0}`, { signal }) // SSE 断线位置显式传给 Server
}


export const AgentAPI = {
  getHealth: () => request('/health'),                                      // 读取服务身份和版本
  listWorkspaces: () => request('/workspace'),                              // 读取工作区及下属会话
  createWorkspace: (path, name) => request('/workspace', 'POST', { path, name }), // 添加工作区定义
  updateWorkspace: (workspaceID, changes) => request('/workspace', 'PATCH', { workspaceId: workspaceID, ...changes }), // 修改工作区
  removeWorkspace: (workspaceID) => request('/workspace', 'DELETE', { workspaceId: workspaceID }), // 仅移除工作区定义
  createSession: (workspaceID, model, agentID) => request('/session', 'POST', { workspaceId: workspaceID, model: model || undefined, agentId: agentID || undefined }), // 创建工作区会话
  getSession: (sessionID) => request(`/session?sessionId=${encodeURIComponent(sessionID)}`), // 读取完整会话
  updateSession: (sessionID, changes) => request('/session', 'PATCH', { sessionId: sessionID, ...changes }), // 修改标题或模型
  removeSession: (sessionID) => request('/session', 'DELETE', { sessionId: sessionID }), // 删除会话
  sendMessage: (sessionID, content, messageID, model, agentID, files) => request('/session/send', 'POST', { sessionId: sessionID, content, messageId: messageID, model: model || undefined, agentId: agentID || undefined, files }), // 启动带真实附件的后台 Agent Run
  stopSession: (sessionID) => request('/session/stop', 'POST', { sessionId: sessionID }), // 停止当前会话 Run
  subscribeSession,                                                       // 订阅递增会话事件
  decideTool: (sessionID, toolCallID, decision, runID) => request('/session/approval', 'POST', { sessionId: sessionID, toolCallId: toolCallID, decision, runId: runID || undefined }), // 提交权限决定
  changeHistory: (sessionID, action, target = {}) => request('/session/history', 'POST', { sessionId: sessionID, action, ...target }), // 回退或撤销历史
  getConfig: () => request('/config'),                                  // 读取脱敏配置
  updateConfig: (changes) => request('/config', 'PATCH', changes),       // 局部更新配置
  testProvider: (provider, model) => request('/config/test', 'POST', { provider, model: model || undefined }), // 真实测试供应商
  listProviderModels: (provider) => request('/config/models', 'POST', { provider }), // 真实读取供应商模型目录
  listTools: () => request('/tool/list'),                                // 读取统一工具目录
  listCapabilities: () => request('/capability/list'),                   // 读取 MCP、LSP 和 Skills 状态
  reloadCapabilities: () => request('/capability/reload', 'POST'),       // 重载外部能力
  listAgents: () => request('/agent/list'),                              // 读取 Agent 与模型目录
  exportData: () => request('/data'),                                    // 导出完整 Agent 备份
  importData: (document) => request('/data', 'POST', document),           // 导入完整 Agent 备份
  clearData: () => request('/data', 'DELETE'),                            // 清理会话和工作区索引
}
