/*
Agent HTTP 指令集：集中声明前端使用的正式 Server API 契约。
一共 18 条路由，分三层：
  基座  /agent/*（发、继续、停、审批）、/sse/connect、/session/{list,create,read,compact}、/health
  会话  /session 下其余动作（分支、改名、设置、回退、撤销回退、删除）
  管理  POST /admin，body 里带 op（设置页和能力页的 30 个动作都在这里）
调用示例：await AgentAPI.getConfig()、await AgentAPI.sendMessage(sessionID, content)。
*/
import { NEW_SESSION_TITLE } from '../defaults.js'

const apiRoot = '/api'                                  // Vite 开发和预览服务转发的同源前缀
const modelIconRevision = 2                             // 换图标来源后改这里，绕过浏览器里的旧 SVG


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

// --- 管理总线：设置页 / 能力页的所有动作 ---
// 这些动作不属于 agent 契约，收在一条路上；op 就是动作名，其余字段是该动作的参数。
const admin = (op, args = {}) => request('/admin', 'POST', { op, ...args })

// 导出和图标要原始 Response（下载文件名 / SVG 字节），不经过 JSON 解析。
async function adminRaw(op, args = {}) {
  const response = await fetch(`${apiRoot}/admin`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, ...args }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `请求失败: ${response.status}`)
  }
  return response
}


// core 0.27 的压缩流带 request:'compact'，由聊天入口分流；compact-finish 带 content / usage。
function subscribeSession(sessionID, signal) {
  return fetch(`${apiRoot}/sse/connect/${encodeURIComponent(sessionID)}`, {
    signal,
    headers: { accept: 'text/event-stream' },
    credentials: 'include',                             // 与普通请求采用相同凭据策略
  })
}


export const AgentAPI = {
  getHealth:        ()                          => request('/health'),
  // 模型 family 自动识别和远程 logo；图标是 SVG，直接当图片地址用。
  getModelFamily:   (model = '')                => admin('model.family', { model }),
  modelIconUrl:     (model = '', family = '', theme = '') => `${apiRoot}/admin?op=model.icon&model=${encodeURIComponent(model)}${family ? `&family=${encodeURIComponent(family)}` : ''}${theme ? `&theme=${encodeURIComponent(theme)}` : ''}&v=${modelIconRevision}`,
  // 全部工具和当前权限，设置页画开关用。
  getTools:         ()                          => admin('tool.list'),
  // 工具类别；名字和顺序由后端给。
  getToolKinds:     ()                          => admin('tool.kinds'),
  // 本机 MCP：已配置的服务 + 其他软件留下的配置（env / headers 只有键名）。
  getMcpCatalog:    (cwd = '')                  => admin('mcp.list', { cwd }),
  saveMcpServer:    (name, definition)          => admin('mcp.save', { name, definition }),
  importMcpServers: (ids, cwd = '')             => admin('mcp.import', { ids, cwd }),
  removeMcpServer:  (name)                      => admin('mcp.remove', { name }),
  toggleMcpServer:  (name, enabled)             => admin('mcp.toggle', { name, enabled }),
  // 真实连一次；连不上返回 { ok: false, error }，不算请求失败。
  testMcpServer:    (name)                      => admin('mcp.test', { name }),
  // 技能：生效清单 + 本机识别到的目录；禁用中的技能也带 enabled=false 返回。
  getSkills:        (cwd = '')                  => admin('skill.list', { cwd }),
  readSkill:        (name, cwd = '')            => admin('skill.read', { name, cwd }),
  saveSkill:        (skill)                     => admin('skill.save', skill),
  removeSkill:      (body)                      => admin('skill.remove', body),
  toggleSkill:      (body)                      => admin('skill.toggle', body),
  toggleSkillSource:(body)                      => admin('skill.source', body),
  // 列表和分组一起返回，前端只需要一次请求。
  getSessionList:   (search = '')               => request(`/session/list${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  // 分组就在列表响应里；这个入口只给还没拿过列表的地方用。
  getSessionGroups: ()                          => request('/session/list').then(data => ({ groups: data.groups || [] })),
  saveSessionGroups:(groups)                    => admin('session.groups.set', { groups }),
  // 会话级设置：思考强度、模型、当前目录都走这一条。
  setSessionCwd:    (sessionID, cwd)            => request(`/session/settings/${encodeURIComponent(sessionID)}`, 'PATCH', { cwd }),
  // 目录属于会话；未指定 cwd 时由后端使用自己的当前目录。
  createSession:    async (cwd, provider, model) => {
    const body = { title: NEW_SESSION_TITLE, provider, model, ...(cwd ? { cwd } : {}) }
    const { sessionId } = await request('/session/create', 'POST', body)
    return request(`/session/read/${encodeURIComponent(sessionId)}`)
  },
  // 从现有会话分出一个新分支；可以只复制到某条消息。
  forkSession:      (sessionID, body = {})     => request(`/session/fork/${encodeURIComponent(sessionID)}`, 'POST', body),
  getSession:       sessionID => request(`/session/read/${encodeURIComponent(sessionID)}`),
  compactSession:   sessionID => request(`/session/compact/${encodeURIComponent(sessionID)}`, 'POST'),
  // 增量读：只返回指定消息之后的新增内容（finishRun / stop / 重连用）
  getSessionDelta:  (sessionID, afterId) => request(`/session/read/${encodeURIComponent(sessionID)}?after=${encodeURIComponent(afterId)}`),
  // 分段读：只给 manifest + 当前段，首次打开有历史压缩的长会话用
  getSessionSegmented: sessionID => request(`/session/read/${encodeURIComponent(sessionID)}?segmented=true`),
  // 读封存段：前端点开展开历史段时按需读取
  getSessionSegment: (sessionID, segmentId) => request(`/session/read/${encodeURIComponent(sessionID)}?segment=${encodeURIComponent(segmentId)}`),
  renameSession:    (sessionID, title)          => request(`/session/rename/${encodeURIComponent(sessionID)}`, 'PATCH', { title }),
  // 已有会话切换模型；运行中也可以切，下一轮请求生效。
  setSessionModel:  (sessionID, provider, model) => request(`/session/settings/${encodeURIComponent(sessionID)}`, 'PATCH', { provider, model }),
  removeSession:    (sessionID)                 => request(`/session/remove/${encodeURIComponent(sessionID)}`, 'DELETE'),
  sendMessage:      (sessionID, input)          => request(`/agent/send/${encodeURIComponent(sessionID)}`, 'POST', { input }),
  // 原生继续被中断的助手回复；服务端调用 core.resume()，不添加用户消息。
  resumeSession:    (sessionID)                 => request(`/agent/resume/${encodeURIComponent(sessionID)}`, 'POST'),
  // 停止时可以带上已经流出的半段回复，Server 先保存再停，刷新后不会丢正文。
  stopSession:      (sessionID, partial)        => request(`/agent/stop/${encodeURIComponent(sessionID)}`, 'POST', partial ? { partial } : undefined),
  subscribeSession,
  // 后端读的字段名是 toolCallId；decision 只有 allow / deny。
  decideTool:       (sessionID, toolCallId, decision) => request(`/agent/decide/${encodeURIComponent(sessionID)}`, 'POST', { toolCallId, decision }),
  // 会话级设置快照：思考强度、模型、当前目录。
  getSettings:      (sessionID)                 => request(`/session/settings/${encodeURIComponent(sessionID)}`),
  saveSettings:     (sessionID, change)         => request(`/session/settings/${encodeURIComponent(sessionID)}`, 'PATCH', change),
  // files=false 表示只退对话不动文件，用户可以在回退确认框里选。
  // 带 toolCallId 就只退那一次工具改的文件，对话不动。
  rollback:         (sessionID, messageId, files = true, partIndex, compact = false) => request(`/session/rollback/${encodeURIComponent(sessionID)}`, 'POST', { messageId, files, ...(partIndex === undefined ? {} : { partIndex }), ...(compact ? { compact: true } : {}) }),
  rollbackTool:     (sessionID, toolCallId, files = true) => request(`/session/rollback/${encodeURIComponent(sessionID)}`, 'POST', { toolCallId, files }),
  redo:             (sessionID, files = true, compact = false) => request(`/session/rollback/redo/${encodeURIComponent(sessionID)}`, 'POST', { files, ...(compact ? { compact: true } : {}) }),
  // --- 以下全部走管理总线 ---
  getConfig:        ()                          => admin('config.read'),
  getConfigMeta:    ()                          => admin('config.meta'),
  getConfigBackups: ()                          => admin('config.backup.list'),
  getSessionStorage:()                          => admin('storage.status'),
  setSessionStorage:(path)                      => admin('storage.set', { path }),
  cancelSessionStorage:()                       => admin('storage.cancel'),
  getFilesystemEntries: ({ path = '', mode = 'directory' } = {}) => admin('fs.entries', { path, mode }),
  readConfigBackup: (id)                        => admin('config.backup.read', { id }),
  restoreConfigBackup: (id)                     => admin('config.restore', { id }),
  importConfig:     (config)                    => admin('config.import', { config }),
  // 导出走原始 Response，保留文件名/下载语义；默认脱敏，secrets=true 才包含 API Key。
  exportConfig:     async secrets => {
    const response = await adminRaw('config.export', { secrets: secrets ? 1 : 0 })
    return response.blob()
  },
  // 整份配置使用 providers[].models[]、models.{chat,compact,title,task}、compact.threshold 和 contextKeep 的四个字段。
  updateConfig:     (changes)                   => admin('config.set', { config: changes }),
  // 用已保存的供应商配置真实请求一次模型，确认这套配置能不能用。
  testProvider:     (provider, model)           => admin('config.test', { provider, model }),
}
