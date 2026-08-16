/*
对话指令：负责发送消息、归约 SSE、停止、审批、附件和历史回退。
SSE 连接在会话打开时建立并持久保持，Agent 循环结束不断开连接。
调用示例：await Chat.send(sessionID, content)、Chat.subscribe(sessionID)、Chat.unsubscribe(sessionID)。
*/
import { AgentAPI } from '../api.js'                    // 引入正式会话和审批 HTTP 契约
import { store } from '../store.js'                     // 引入完整会话和事件位置
import { readNDJSON } from '../utils/ndjson.js'         // 引入 NDJSON 流解析能力（后端格式）
import { Session } from './session.js'                  // 引入终态刷新和摘要同步
import { UI } from './ui.js'                            // 引入复制和轻反馈
import { t } from '../i18n.js'                          // 引入当前语言反馈文案


// --- 读取当前会话 ---
function current() {
  return store.sessions[store.ui.activeSessionID] || null // 页面只消费当前活动会话
}


// --- 提交输入内容 ---
function submitInput(content, isRunning, emit) {
  const text = content.value.trim()                       // 空白输入没有业务含义
  if (!text || isRunning) return false                    // 运行中拒绝重复发送
  content.value = ''                                      // 触发成功后立即清空输入
  emit('send', text)                                      // 把有效消息交给页面指令
  return true                                             // 输入组件恢复焦点
}


// --- 建立持久 SSE 订阅（会话打开时调用）---
async function subscribe(sessionID) {
  const existing = store.events.controllers[sessionID]    // 检查是否已有连接
  if (existing) return                                    // 避免重复订阅

  const controller = new AbortController()                // 独立控制当前 SSE 生命周期
  store.events.controllers[sessionID] = controller        // 注册到全局便于 unsubscribe 使用

  try {
    const response = await AgentAPI.subscribeSession(sessionID, 0, controller.signal) // 建立 SSE 连接
    void consume(sessionID, response, controller)          // 后台持续消费事件
  } catch (error) {
    if (controller.signal.aborted) return                  // 被主动关闭的不报错
    delete store.events.controllers[sessionID]             // 连接失败清除引用
  }
}


// --- 关闭 SSE 订阅（离开会话页时调用）---
function unsubscribe(sessionID) {
  const controller = store.events.controllers[sessionID]  // 读取当前连接控制器
  if (controller) {
    controller.abort()                                     // 断开 SSE 连接
    delete store.events.controllers[sessionID]             // 清除引用
  }
}


// --- 发送用户消息（SSE 已在会话打开时建立）---
async function send(sessionID, content) {
  const session = store.sessions[sessionID]               // 读取目标会话
  const text = content.trim()                              // 消息不保留无意义首尾空白
  if (!session || !text || session.status === 'running') return false // 无会话、空文本和重复发送均拒绝

  const userMessage = {
    id: `msg_${crypto.randomUUID()}`,                    // 本地临时身份，Server 确认后不替换
    role: 'user',                                        // 标识发送方为用户
    content: text,                                       // 用户输入的纯文本内容
    createdAt: Date.now(),                               // 输入时间戳用于时间线排序
  }
  const pendingAssistant = {
    id: `pending_${crypto.randomUUID()}`,                // 占位身份，SSE 完成后会被 Server 真实 ID 替换
    role: 'assistant',                                   // 标识为助手响应
    content: '',                                         // 流式增量文本将持续追加到此字段
    reasoning: '',                                       // 流式推理增量追加到此字段
    tools: [],                                           // 工具调用事件到达后逐条追加
    createdAt: Date.now(),                               // 创建时间
    isStreaming: true,                                   // 标识当前仍在接收流式数据
    request: { status: 'running', input: 0, output: 0, cache: 0, duration: 0 }, // 请求状态和用量占位
  }
  session.messages.push(userMessage, pendingAssistant)   // 输入和请求状态即时反馈
  session.status = 'running'                             // 输入器切换为停止按钮
  session.updatedAt = Date.now()                         // 会话进入最近活动
  Session.syncSummary(session)                           // 侧边栏和主页同步运行状态

  try {
    await AgentAPI.sendMessage(sessionID, text)            // POST 发送消息，后端通过已建立的 SSE 推送响应
    return true                                           // 反馈发送动作已接受
  } catch (error) {
    pendingAssistant.isStreaming = false                  // 关闭响应打字状态
    pendingAssistant.request.status = 'failed'            // 请求条进入错误状态
    pendingAssistant.error = error.message                // 原位展示真实 API 错误
    session.status = 'idle'                               // 恢复输入器
    Session.syncSummary(session)                          // 主页状态同步恢复
    return false                                          // 反馈发送失败
  }
}


// --- 消费当前执行的事件流 ---
async function consume(sessionID, response, controller) {
  try {
    await readNDJSON(response, (event) => receive(sessionID, event, controller)) // 事件严格按网络顺序修改会话
  } catch (error) {
    if (controller.signal.aborted) return                 // 终态和用户停止造成的中断不是错误
    const session = store.sessions[sessionID]             // 读取仍在页面中的会话
    if (!session) return                                  // 会话被删除后无需反馈
    session.status = 'idle'                               // 网络失败不能让输入器永久锁定
    const assistant = getStreamingAssistant(session)      // 找到当前响应占位
    if (assistant) {
      assistant.isStreaming = false                       // 关闭打字状态
      assistant.request.status = 'failed'                 // 请求条进入故障状态
      assistant.error = error.message                     // 原位展示订阅错误
    }
    Session.syncSummary(session)                          // 侧栏同步故障终态
  }
}


// --- 归约一个 Server 事件（分发到对应处理函数）---
async function receive(sessionID, event, controller) {
  const session = store.sessions[sessionID]               // 读取事件所属完整会话
  if (!session) return                                    // 已删除或未加载会话忽略旧事件
  const assistant = getStreamingAssistant(session)        // 当前增量统一写入最新响应占位

  if (event.type === 'data-session') return receiveSessionSnapshot(session, event) // 连接时初始快照
  if (event.type === 'data-status') return receiveStatus(session, event, assistant) // 运行状态变更
  if (event.type === 'text-delta') return receiveTextDelta(session, event, assistant) // 文本增量
  if (event.type === 'reasoning') return receiveReasoningDelta(session, event, assistant) // 推理增量
  if (event.type === 'tool-input-delta') return receiveToolInputDelta(session, event, assistant) // 工具输入增量
  if (event.type === 'data-message') return receiveMessage(session, event, assistant) // 完整消息
  if (event.type === 'data-permission') return receiveApproval(session, event, assistant) // 审批请求
  if (event.type === 'data-tool-output') return receiveToolOutput(session, event, assistant) // 工具输出流
  if (event.type === 'error') return receiveError(session, event, assistant) // 错误
}


// --- 处理 data-session 事件：连接时推送初始会话快照 ---
function receiveSessionSnapshot(session, event) {
  if (event.data?.status === 'running' && session.status !== 'running') {
    session.status = 'running'
    Session.syncSummary(session)
  }
}


// --- 处理 data-status 事件：Agent 循环开始或结束 ---
function receiveStatus(session, event, assistant) {
  if (event.data.status === 'running' && session.status !== 'running') {
    session.status = 'running'                            // 后端开始循环，UI 切换为运行状态
    Session.syncSummary(session)                          // 侧边栏同步
    // 如果没有正在流式的 assistant 占位（比如从后端恢复运行状态），创建一个
    if (!assistant) {
      const newAssistant = {
        id: `pending_${crypto.randomUUID()}`,             // 占位身份
        role: 'assistant',                                // 助手角色
        content: '',                                      // 等待流式增量
        reasoning: '',                                    // 等待推理增量
        tools: [],                                        // 等待工具事件
        createdAt: Date.now(),                            // 占位创建时间
        isStreaming: true,                                // 标识接收中
        request: { status: 'running', input: 0, output: 0, cache: 0, duration: 0 }, // 用量占位
      }
      session.messages.push(newAssistant)
    }
  }
  if (event.data.status === 'idle' && session.status === 'running') {
    session.status = 'idle'                               // 输入器恢复发送动作
    if (assistant) {
      assistant.isStreaming = false                       // 终态关闭打字状态
      assistant.request.status = 'completed'              // 映射完成终态
    }
    Session.syncSummary(session)                          // 列表同步终态
    // 首次完成时异步生成标题（不阻塞 UI）
    if (!session.titleGenerated) {
      session.titleGenerated = true                      // 防止重复触发
      const firstUserMsg = session.messages.find(m => m.role === 'user')
      const prompt = typeof firstUserMsg?.content === 'string' ? firstUserMsg.content : (Array.isArray(firstUserMsg?.content) ? firstUserMsg.content.filter(b => b.type === 'text').map(b => b.text).join('') : '')
      if (prompt) {
        AgentAPI.generateTitle(session.id, prompt).then(({ title }) => {
          if (title && store.sessions[session.id]) {
            store.sessions[session.id].title = title      // 更新会话完整数据
            Session.syncSummary(store.sessions[session.id]) // 侧边栏刷新标题
          }
        }).catch(() => {})                               // 标题失败不影响对话
      }
    }
    // 注意：不断开 SSE，连接保持以接收下一轮事件
  }
}


// --- 处理 text-delta 事件：追加模型正文增量 ---
function receiveTextDelta(session, event, assistant) {
  const streamingMessage = assistant || createAssistant(session) // 没有流式占位则新建（Agent 循环新一轮）
  streamingMessage.content += event.textDelta || ''              // 追加模型正文增量（AI SDK 字段）
}


// --- 处理 reasoning 事件：追加模型推理增量 ---
function receiveReasoningDelta(session, event, assistant) {
  const streamingMessage = assistant || createAssistant(session) // 没有流式占位则新建
  streamingMessage.reasoning += event.textDelta || ''            // 追加模型推理增量（AI SDK 字段）
}


// --- 处理 tool-input-delta 事件：工具调用输入增量（AI SDK 流式格式）---
function receiveToolInputDelta(session, event, assistant) {
  const { toolCallId, argsTextDelta } = event                    // AI SDK 字段
  if (!toolCallId) return                                        // 无 ID 时忽略
  const streamingMessage = assistant || createAssistant(session) // 没有流式占位则新建
  let tool = streamingMessage.tools.find(t => t.id === toolCallId)
  if (!tool) {
    tool = { id: toolCallId, name: toolCallId, title: toolCallId, input: {}, preview: '', status: 'running', checkpoint: null }
    streamingMessage.tools.push(tool)                            // 首次出现时创建工具条
  }
  // 累积参数文本，尝试解析为对象
  tool._argsText = (tool._argsText || '') + (argsTextDelta || '')
  try { tool.input = JSON.parse(tool._argsText) } catch { /* 参数还不完整，等待更多增量 */ }
}


// --- 处理 data-tool-output 事件：实时追加工具输出预览 ---
function receiveToolOutput(session, event, assistant) {
  const streamingMessage = assistant || createAssistant(session) // 确保有活跃流式占位
  const tool = streamingMessage.tools.find((item) => item.id === event.data?.callID) // 定位正在执行的工具
  if (tool) tool.preview += String(event.data?.output ?? '') // 实时追加工具输出预览
}


// --- 处理 tool-result 事件：写入工具执行终态 ---
function receiveToolResult(session, event, assistant) {
  const streamingMessage = assistant || createAssistant(session) // 确保有活跃流式占位
  const result = event.data.toolResult ?? event.data            // 兼容不同结构
  const toolCallID = result.toolCallId                          // 定位目标工具条
  const tool = streamingMessage.tools.find((item) => item.id === toolCallID)
  if (tool) {
    tool.status = result.isError ? 'error' : 'completed'       // 根据错误标记设置终态
    tool.preview = result.result ?? tool.preview                // 使用最终结果替换预览
  }
}


// --- 处理 data-message 事件：后端推送完整消息 ---
function receiveMessage(session, event, assistant) {
  if (!event.data?.message) return                              // 无消息体忽略
  const msg = event.data.message                                // 后端推送完整消息
  if (msg.role === 'user') return                                // 用户消息由 send() 处理，忽略后端回显
  if (msg.role === 'assistant') {
    const streamingMessage = assistant || createAssistant(session) // 没有流式占位则新建
    if (msg.id) streamingMessage.id = msg.id                    // 使用 Server 真实 ID
    const content = typeof msg.content === 'string' ? msg.content : (Array.isArray(msg.content) ? msg.content.filter(b => b.type === 'text').map(b => b.text).join('') : '')
    const reasoning = Array.isArray(msg.content) ? msg.content.filter(b => b.type === 'reasoning').map(b => b.text).join('') : ''
    if (content) streamingMessage.content = content             // 完整消息替换增量累积
    if (reasoning) streamingMessage.reasoning = reasoning       // 完整推理替换累积
    if (msg.usage) applyUsage(session, streamingMessage, msg.usage) // 应用本轮用量
    const toolCalls = Array.isArray(msg.content) ? msg.content.filter(b => b.type === 'tool-call' && b.toolName !== 'finish' && b.toolName !== 'delegate_task') : []
    for (const call of toolCalls) upsertTool(streamingMessage, call, 'running')
    // 定格当前轮次：下一轮 text-delta 会自动创建新占位
    streamingMessage.isStreaming = false                         // 定格：本轮 assistant 回复完成
    streamingMessage.request.status = 'completed'               // 映射完成终态
  }
}


// --- 处理 data-permission 事件：展示审批请求 ---
function receiveApproval(session, event, assistant) {
  const streamingMessage = assistant || createAssistant(session) // 确保有占位
  const { callID, tool, input } = event.data ?? {}               // 后端字段
  if (!callID) return                                            // 无 ID 时忽略
  upsertTool(streamingMessage, { toolCallId: callID, toolName: tool, input }, 'waiting') // 展示审批请求
}


// --- 处理 error 事件：展示不可恢复错误 ---
function receiveError(session, event, assistant) {
  const streamingMessage = assistant || createAssistant(session) // 确保有占位
  streamingMessage.error = event.errorText || event.data?.message || '未知错误' // 展示不可恢复错误
  // 如果有重试信息不关闭打字状态（属于 retry 阶段）
  if (!event.data.attempt) {
    assistant.request.status = 'failed'                          // 请求条进入故障状态
    assistant.isStreaming = false                                // 关闭打字状态
  }
}


// --- 创建或更新工具展示条 ---
function upsertTool(assistant, data, status) {
  const toolCallID = data.toolCallId || data.id           // 兼容 AI SDK 和审批自定义事件字段
  let tool = assistant.tools.find((item) => item.id === toolCallID) // 定位同一次工具调用
  if (!tool) {
    tool = { id: toolCallID, name: data.toolName || data.name, title: data.toolName || data.name, input: data.input || data.args || {}, preview: '', status, checkpoint: null } // 建立完整展示结构
    assistant.tools.push(tool)                            // 工具原位进入当前助手消息
  }
  tool.status = status                                    // 最新事件更新运行或审批状态
  tool.input = data.input || data.args || tool.input      // 工具调用事件补齐真实输入
  if (data.output !== undefined) tool.preview = formatOutput(data.output) // 工具结果转换为紧凑预览
}


// --- 格式化工具结果 ---
function formatOutput(output) {
  if (output?.type === 'text' || output?.type === 'error-text') return output.value // AI SDK 文本结果直接展示
  if (output?.type === 'execution-denied') return output.reason || t('toolDenied') // 展示工具拒绝原因
  return JSON.stringify(output?.value ?? output ?? '')    // JSON 结果保持真实结构
}


// --- 应用模型用量反馈 ---
function applyUsage(session, assistant, usage) {
  const input = Number(usage.inputTokens ?? usage.promptTokens ?? 0)     // 兼容 AI SDK 不同供应商字段
  const output = Number(usage.outputTokens ?? usage.completionTokens ?? 0) // 读取真实输出 token
  const cache = Number(usage.cachedInputTokens ?? 0)                      // 读取可用缓存 token
  Object.assign(assistant.request, { input, output, cache })              // 请求条展示本轮用量
  session.inputTokens += input                                             // 累计会话输入
  session.outputTokens += output                                           // 累计会话输出
  session.cacheTokens += cache                                             // 累计缓存读取
  session.contextTokens = input + output                                   // 圆环展示最近请求上下文
}


// --- 读取当前流式助手消息 ---
function getStreamingAssistant(session) {
  return [...session.messages].reverse().find((message) => message.role === 'assistant' && message.isStreaming) // 最新执行只修改自己的占位消息
}


// --- 创建新的流式助手占位（Agent 循环新一轮开始时）---
function createAssistant(session) {
  const assistant = { id: `pending_${crypto.randomUUID()}`, role: 'assistant', content: '', reasoning: '', tools: [], createdAt: Date.now(), isStreaming: true, request: { status: 'running', input: 0, output: 0, cache: 0, duration: 0 } }
  session.messages.push(assistant)                        // 新占位进入消息列表
  return assistant                                        // 返回供事件归约写入
}


// --- 停止当前执行 ---
async function stop(sessionID) {
  const session = store.sessions[sessionID]               // 读取目标会话
  if (!session || session.status !== 'running') return false // 非运行状态无需停止
  try {
    await AgentAPI.stopSession(sessionID)                  // Server 中断模型、工具和审批等待
    UI.notify(t('generationPaused'))                       // 终态 SSE 会恢复输入器
    return true                                            // 反馈停止信号已接受
  } catch (error) {
    UI.notify(error.message)                               // 展示停止失败的真实错误
    return false                                           // 保持当前运行状态等待事件
  }
}


// --- 处理工具审批 ---
async function decide(sessionID, toolCallID, decision) {
  const session = store.sessions[sessionID]                // 读取审批所属会话
  const tool = session?.messages.flatMap((item) => item.tools || []).find((item) => item.id === toolCallID) // 定位原位工具条
  if (!tool || !['deny', 'allow-once', 'always-allow'].includes(decision)) return false // 无效决定不修改数据
  try {
    const action = decision === 'deny' ? 'deny' : 'allow'      // 映射到后端 action 字段
    const scope = decision === 'always-allow' ? 'always' : 'once' // 映射到后端 scope 字段
    await AgentAPI.decideTool(sessionID, toolCallID, action, scope) // 恢复等待中的工具
    tool.decision = decision                             // 保存本次用户决定
    tool.status = decision === 'deny' ? 'rejected' : 'running' // 允许后等待真实工具结果
    UI.notify(t(decision === 'deny' ? 'toolDenied' : 'toolAllowed')) // 确认点击已提交
    return true                                          // 通知工具条退出审批状态
  } catch (error) {
    UI.notify(error.message)                             // 审批竞争或过期时展示 Server 反馈
    return false                                         // 保持当前条供刷新校准
  }
}


// --- 添加输入附件 ---
async function attach(sessionID, files) {
  const session = store.sessions[sessionID]              // 读取附件所属会话
  if (!session) return false                              // 无会话不能保存附件草稿
  for (const file of files) {
    if (session.files.some((item) => item.name === file.name && item.size === file.size)) continue // 避免重复选择同一文件
    if (file.size > 1048576) { UI.notify(`${file.name} 超过 1 MiB`); continue } // 1048576 字节 = 1 MiB，与 Server 请求体上限保持一致
    const bytes = new Uint8Array(await file.arrayBuffer())              // 读取用户真实选择的附件内容
    let binary = ''                                                     // Base64 编码前建立字节字符串
    bytes.forEach((byte) => { binary += String.fromCharCode(byte) })     // 保持任意文本和二进制字节不丢失
    session.files.push({ id: `file-${crypto.randomUUID()}`, name: file.name, size: file.size, type: file.type || 'application/octet-stream', content: btoa(binary) }) // 保存可发送的附件正文
  }
  return true                                            // 输入框即时展示附件
}


// --- 移除输入附件 ---
function removeFile(sessionID, fileID) {
  const session = store.sessions[sessionID]              // 读取附件草稿
  if (!session) return false                              // 无会话保持页面不变
  const index = session.files.findIndex((file) => file.id === fileID) // 找到对应附件
  if (index < 0) return false                             // 已移除附件无需重复动作
  session.files.splice(index, 1)                         // 从输入区移除附件
  return true                                            // 反馈动作完成
}


// --- 回退到工具步骤 ---
async function rollback(sessionID, checkpoint) {
  UI.notify('回退功能尚未支持')                            // Server 未实现 history 接口
  return false                                           // 保持当前历史
}


// --- 回退用户消息并填回输入框 ---
async function rollbackMessage(sessionID, messageID) {
  UI.notify('回退功能尚未支持')                            // Server 未实现 history 接口
  return false                                           // 保持当前历史
}


// --- 撤销最近回退 ---
async function undoRollback(sessionID) {
  UI.notify('撤销回退功能尚未支持')                        // Server 未实现 history 接口
  return false                                           // 保持当前状态
}


export const Chat = { current, submitInput, subscribe, unsubscribe, send, receive, stop, decide, attach, removeFile, rollback, rollbackMessage, undoRollback } // 暴露全部对话动作
