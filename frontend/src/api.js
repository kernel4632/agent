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
    credentials: 'include',                             // 携带 HttpOnly cookie 完成鉴权
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
  return fetch(`${apiRoot}/session/events?sessionID=${encodeURIComponent(sessionID)}`, {
    signal,
    credentials: 'include',                             // 携带 cookie 通过鉴权
  })
}


export const AgentAPI = {
  getHealth:        ()                          => request('/health'),
  login:            (username, password)        => request('/login', 'POST', { username, password }),
  logout:           ()                          => request('/logout', 'POST'),
  listWorkspaces:   ()                          => request('/workspace'),
  createWorkspace:  (path)                      => request('/workspace', 'POST', { path }),
  removeWorkspace:  (workspaceID)               => request(`/workspace?id=${encodeURIComponent(workspaceID)}`, 'DELETE'),
  createSession:    (workspaceID, provider, model) => request('/session', 'POST', { workspaceID, provider, model }),
  getSession:       (sessionID)                 => request(`/session?id=${encodeURIComponent(sessionID)}`),
  updateSession:    (sessionID, changes)        => request('/session', 'PATCH', { id: sessionID, ...changes }),
  removeSession:    (sessionID)                 => request(`/session?id=${encodeURIComponent(sessionID)}`, 'DELETE'),
  sendMessage:      (sessionID, message)        => request('/agent/send', 'POST', { sessionID, message }),
  stopSession:      (sessionID)                 => request('/agent/stop', 'POST', { sessionID }),
  subscribeSession,
  decideTool:       (sessionID, callID, action, scope) => request('/permission/decide', 'POST', { sessionID, callID, action, scope }),
  getConfig:        ()                          => request('/config'),
  updateConfig:     (changes)                   => request('/config', 'PATCH', changes),
}
