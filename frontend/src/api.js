/*
Agent HTTP 指令集：集中声明前端使用的正式 Server API 契约。
普通请求统一解析 JSON；会话事件保留原始 Response 交给 SSE 工具按顺序读取。
调用示例：await AgentAPI.getConfig()、await AgentAPI.sendMessage(sessionID, content)。
*/
const apiRoot = '/api'                                  // Vite 开发和预览服务转发的同源前缀


// --- 发送普通 JSON 请求 ---
async function request(path, method = 'GET', body) {
  const response = await fetch(`${apiRoot}${path}`, {   // 向真实 Agent Server 发起 HTTP 请求
    method,                                             // 使用业务动作指定方法
    credentials: 'include',                             // 保留同源凭据；当前后端没有登录鉴权接口
    headers: body === undefined ? undefined : { 'content-type': 'application/json' }, // 有请求体时声明 JSON
    body: body === undefined ? undefined : JSON.stringify(body), // 将结构化数据编码为请求正文
  })
  const data = await response.json().catch(() => ({ error: `服务暂不可用 (${response.status})，请检查后端连接` }))
  if (!response.ok) {
    const error = new Error(data.error ?? `请求失败: ${response.status}`) // 将 HTTP 失败转换为可展示异常
    error.status = response.status                      // 保留状态码供冲突场景处理
    error.data = data                                   // 保留业务字段供界面反馈
    throw error
  }
  return data                                           // 返回对应指令的业务结果
}


// --- 建立会话事件订阅 ---
function subscribeSession(sessionID, signal) {
  return fetch(`${apiRoot}/sse/connect/${encodeURIComponent(sessionID)}`, {
    signal,
    headers: { accept: 'text/event-stream' },
    credentials: 'include',                             // 与普通请求采用相同凭据策略
  })
}


export const AgentAPI = {
  getHealth:        ()                          => request('/health'),
  getWorkspace:     ()                          => request('/workspace/read'),
  getSessionList:   (search = '')               => request(`/session/list${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  createSession:    async (workspaceID, provider, model) => {
    const { sessionId } = await request('/session/create', 'POST', { title: '新对话', provider, model })
    return request(`/session/read/${encodeURIComponent(sessionId)}`)
  },
  getSession:       (sessionID)                 => request(`/session/read/${encodeURIComponent(sessionID)}`),
  renameSession:    (sessionID, title)          => request(`/session/rename/${encodeURIComponent(sessionID)}`, 'PATCH', { title }),
  removeSession:    (sessionID)                 => request(`/session/remove/${encodeURIComponent(sessionID)}`, 'DELETE'),
  sendMessage:      (sessionID, input)          => request(`/agent/send/${encodeURIComponent(sessionID)}`, 'POST', { input }),
  stopSession:      (sessionID)                 => request(`/agent/stop/${encodeURIComponent(sessionID)}`, 'POST'),
  subscribeSession,
  // 后端读的字段名是 toolCallId；写成 callId 会静默返回 ok:false，审批决定等于没发。
  decideTool:       (sessionID, toolCallId, decision) => request(`/agent/decide/${encodeURIComponent(sessionID)}`, 'POST', { toolCallId, decision }),
  getChanges:       (sessionID)                 => request(`/session/changes/${encodeURIComponent(sessionID)}`),
  // files=false 表示只退对话不动文件，用户可以在回退确认框里选。
  previewRollback:  (sessionID, messageId)      => request(`/session/rollback/preview/${encodeURIComponent(sessionID)}`, 'POST', { messageId }),
  rollback:         (sessionID, messageId, files = true) => request(`/session/rollback/${encodeURIComponent(sessionID)}`, 'POST', { messageId, files }),
  redo:             (sessionID, files = true)   => request(`/session/redo/${encodeURIComponent(sessionID)}`, 'POST', { files }),
  getConfig:        ()                          => request('/config/read'),
  updateConfig:     (changes)                   => request('/config/set', 'PATCH', changes),
  // 用已保存的供应商配置真实请求一次模型，确认这套配置能不能用。
  testProvider:     (provider, model)           => request('/config/test', 'POST', { provider, model }),
}
