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
  return fetch(`${apiRoot}/sse?id=${encodeURIComponent(sessionID)}`, { signal }) // SSE 连接使用会话 ID
}


export const AgentAPI = {
  getHealth: () => request('/health'),                                      // 读取服务身份和版本
  listWorkspaces: () => request('/workspace'),                              // 读取工作区及下属会话
  createWorkspace: (path) => request('/workspace', 'POST', { path }),       // 添加工作区定义
  updateWorkspace: (workspaceID, changes) => request('/workspace', 'PATCH', { id: workspaceID, ...changes }), // 修改工作区
  removeWorkspace: (workspaceID) => request(`/workspace?id=${encodeURIComponent(workspaceID)}`, 'DELETE'), // 仅移除工作区定义
  createSession: (workspaceID, model) => request('/session', 'POST', { workspaceId: workspaceID, model: model || undefined }), // 创建工作区会话
  getSession: (sessionID) => request(`/session?id=${encodeURIComponent(sessionID)}`), // 读取完整会话
  updateSession: (sessionID, changes) => request('/session', 'PATCH', { id: sessionID, ...changes }), // 修改标题或模型
  removeSession: (sessionID) => request(`/session?id=${encodeURIComponent(sessionID)}`, 'DELETE'), // 删除会话
  sendMessage: (sessionID, content) => request('/agent/send', 'POST', { id: sessionID, content }), // 发送模型请求
  stopSession: (sessionID) => request('/agent/stop', 'POST', { id: sessionID }), // 停止当前会话执行
  subscribeSession,                                                       // 订阅递增会话事件
  decideTool: (sessionID, toolCallID, decision) => request('/agent/approve', 'POST', { id: sessionID, toolCallId: toolCallID, approved: decision !== 'deny' }), // 提交权限决定
  generateTitle: (sessionID, prompt) => request('/title', 'POST', { id: sessionID, prompt }), // 为会话生成标题
  getConfig: () => request('/config'),                                  // 读取脱敏配置
  updateConfig: (changes) => request('/config', 'PATCH', changes),       // 局部更新配置
}
