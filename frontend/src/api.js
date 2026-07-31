/*
Agent HTTP 指令集：集中声明前端会调用的 Server API。
普通请求返回 JSON；sendMessage 保留原始 SSE Response，由 utils/sse.js 持续消费。
调用示例：await AgentAPI.listSessions()、await AgentAPI.sendMessage({ message: '你好' })。
*/
const apiRoot = '/api'                              // Vite 与桌面宿主统一代理的 API 前缀


// --- 发送普通 JSON 请求 ---
async function request(path, options = {}) {
  const response = await fetch(`${apiRoot}${path}`, { // 向真实 Agent Server 发起 HTTP 请求
    ...options,                                       // 保留调用方指定的方法与信号
    headers: options.body ? { 'content-type': 'application/json', ...options.headers } : options.headers, // JSON 请求声明媒体类型
  })
  const data = await response.json()                  // 普通接口统一读取 JSON 反馈
  if (!response.ok) throw new Error(data.error ?? `请求失败: ${response.status}`) // HTTP 错误转换为可展示异常
  return data                                         // 返回对应指令的业务结果
}


// --- 发送消息并取得 SSE 流 ---
async function sendMessage({ sessionID, messageID, message, signal }) {
  const response = await fetch(`${apiRoot}/chat/send`, { // 启动真实 Agent 循环
    method: 'POST',                                    // 对话触发使用 POST
    headers: { 'content-type': 'application/json' },   // 请求体按 JSON 编码
    body: JSON.stringify({ sessionId: sessionID || undefined, messageId: messageID, message }), // 共享消息 ID 让当前页面可立即回退
    signal,                                            // 允许 stop 与页面卸载中断连接
  })
  if (!response.ok) throw new Error((await response.json()).error ?? '发送失败') // 启动失败时反馈 Server 原因
  return response                                      // SSE 正文交给流解析工具消费
}


export const AgentAPI = {                              // 导出全部 Server 业务指令
  sendMessage,                                         // 启动 Agent SSE 对话
  stopChat: (sessionID) => request('/chat/stop', { method: 'POST', body: JSON.stringify({ sessionId: sessionID }) }), // 中断运行中循环
  decideTool: (sessionID, toolCallID, decision) => request('/chat/approval', { method: 'POST', body: JSON.stringify({ sessionId: sessionID, toolCallId: toolCallID, decision }) }), // 提交拒绝、本次允许或永久允许
  createSession: () => request('/session/create', { method: 'POST' }), // 创建空会话
  listSessions: () => request('/session/list'),       // 读取会话摘要
  getSession: (sessionID) => request(`/session/${sessionID}`), // 读取完整会话
  renameSession: (sessionID, title) => request(`/session/${sessionID}`, { method: 'PATCH', body: JSON.stringify({ title }) }), // 保存用户会话标题
  getTasks: (sessionID) => request(`/session/${sessionID}/tasks`), // 读取修订化任务清单
  updateTasks: (sessionID, tasks, taskRevision) => request(`/session/${sessionID}/tasks`, { method: 'PUT', body: JSON.stringify({ tasks, taskRevision }) }), // 按修订号替换任务清单
  removeSession: (sessionID) => request(`/session/${sessionID}`, { method: 'DELETE' }), // 删除会话
  rollbackSession: (sessionID, step) => request(`/session/${sessionID}/rollback/${step}`, { method: 'POST' }), // 回滚到工具步骤
  rollbackMessage: (sessionID, messageID) => request(`/session/${sessionID}/rollback-message`, { method: 'POST', body: JSON.stringify({ messageId: messageID }) }), // 回退用户消息供编辑重发
  undoRollback: (sessionID) => request(`/session/${sessionID}/undo-rollback`, { method: 'POST' }), // 撤销回滚
  listTools: () => request('/tool/list'),             // 读取工具注册表
  reloadTools: () => request('/tool/reload', { method: 'POST' }), // 重新扫描工具
  getConfig: () => request('/config'),                // 读取脱敏配置
  updateConfig: (changes) => request('/config', { method: 'PUT', body: JSON.stringify(changes) }), // 局部更新配置
  testProvider: (provider, model) => request('/config/test', { method: 'POST', body: JSON.stringify({ provider, model: model || undefined }) }), // 测试已保存提供商连接
}
