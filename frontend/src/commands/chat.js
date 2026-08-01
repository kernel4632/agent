/*
对话指令：负责发送消息、归约 SSE、停止、审批、附件和历史回退。
用户触发先调用正式 API，事件按递增 ID 修改当前会话，终态再读取持久化历史校准。
调用示例：await Chat.send(sessionID, content)、await Chat.decide(sessionID, toolCallID, decision)。
*/
import { AgentAPI } from '../api.js'                    // 引入正式会话和审批 HTTP 契约
import { store } from '../store.js'                     // 引入完整会话和事件位置
import { readSSE } from '../utils/sse.js'               // 引入标准递增 SSE 解析能力
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


// --- 发送用户消息并启动事件订阅 ---
async function send(sessionID, content) {
  const session = store.sessions[sessionID]               // 读取目标会话
  const text = content.trim()                              // 消息不保留无意义首尾空白
  if (!session || !text || session.status === 'running') return false // 无会话、空文本和重复发送均拒绝

  const messageID = `msg_${crypto.randomUUID()}`          // 客户端身份与 Server 持久化保持一致
  const files = [...session.files]                         // 保存本轮真实附件，清空输入区后仍可发送
  const userMessage = { id: messageID, role: 'user', content: text, contentBlocks: [{ type: 'text', text: { text } }], files: files.map(({ content: _content, ...file }) => file), createdAt: Date.now() } // 输入立即进入时间线且不把正文重复放入 UI
  const assistant = { id: `pending_${crypto.randomUUID()}`, role: 'assistant', content: '', reasoning: '', tools: [], createdAt: Date.now(), isStreaming: true, request: { status: 'running', input: 0, output: 0, cache: 0, duration: 0 } } // 建立当前响应占位
  session.rollback = null                                // 新消息正式提交当前回退分支
  session.files = []                                     // 附件归属用户消息后清空输入区
  session.messages.push(userMessage, assistant)          // 输入和请求状态即时反馈
  session.status = 'running'                             // 输入器切换为停止按钮
  session.updatedAt = Date.now()                         // 会话进入最近活动
  Session.syncSummary(session)                           // 侧边栏和主页同步运行状态

  const previousController = store.events.controllers[sessionID] // 读取旧订阅控制器
  previousController?.abort()                            // 同一会话只保留一个事件读取循环
  const controller = new AbortController()               // 当前执行使用独立订阅中断信号
  store.events.controllers[sessionID] = controller       // 停止和终态可以释放订阅
  const afterID = store.events.lastIDs[sessionID] || 0   // 从最后确认事件继续读取
  const eventResponse = AgentAPI.subscribeSession(sessionID, afterID, controller.signal) // 并发建立订阅，空历史时等待首事件

  try {
    await AgentAPI.sendMessage(sessionID, text, messageID, files) // 会话模型已在创建或切换时持久化
    const response = await eventResponse                  // 执行已启动后取得事件流响应
    void consume(sessionID, response, controller)         // 后台持续归约事件，不阻塞输入事件栈
    return true                                           // 反馈发送动作已接受
  } catch (error) {
    controller.abort()                                    // 启动失败释放尚未建立的订阅
    assistant.isStreaming = false                         // 关闭响应打字状态
    assistant.request.status = 'failed'                   // 请求条进入错误状态
    assistant.error = error.message                       // 原位展示真实 API 错误
    session.status = 'idle'                               // 恢复输入器
    Session.syncSummary(session)                          // 主页状态同步恢复
    return false                                          // 反馈发送失败
  }
}


// --- 消费当前执行的事件流 ---
async function consume(sessionID, response, controller) {
  try {
    await readSSE(response, (event) => receive(sessionID, event, controller)) // 事件严格按网络顺序修改会话
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


// --- 归约一个 Server 事件 ---
async function receive(sessionID, event, controller) {
  const session = store.sessions[sessionID]               // 读取事件所属完整会话
  if (!session) return                                    // 已删除或未加载会话忽略旧事件
  if (event.id && event.id <= (store.events.lastIDs[sessionID] || 0)) return // 重放重复事件不能二次修改页面
  if (event.id) store.events.lastIDs[sessionID] = event.id // 成功接收后推进断线位置
  const assistant = getStreamingAssistant(session)        // 当前增量统一写入最新响应占位

  if (event.name === 'text-delta' && assistant) assistant.content += event.data.text || '' // 追加模型正文增量
  if (event.name === 'reasoning-delta' && assistant) assistant.reasoning += event.data.text || '' // 追加模型推理增量
  if (event.name === 'tool-call' && assistant) upsertTool(assistant, event.data, 'running') // 展示模型工具声明
  if (event.name === 'tool-approval-request' && assistant) upsertTool(assistant, { toolCallId: event.data.id, toolName: event.data.name, input: event.data.args }, 'waiting') // 展示三选一审批
  if (event.name === 'tool-result' && assistant) upsertTool(assistant, event.data, event.data.output?.denied ? 'rejected' : 'completed') // 展示真实工具结果
  if (event.name === 'task-list-updated') {
    session.tasks = event.data.tasks || []                // 任务面板使用 Server 持久化清单
    session.taskRevision = event.data.taskRevision        // 保存并发修订号
  }
  if (event.name === 'session-title') {
    session.title = event.data.title                      // 异步模型标题更新对话页
    Session.syncSummary(session)                          // 同步主页与侧栏标题
  }
  if ((event.name === 'finish-step' || event.name === 'finish') && assistant && event.data.usage) applyUsage(session, assistant, event.data.usage) // 处理 AI SDK 用量结构
  if (event.name === 'usage' && assistant) applyUsage(session, assistant, event.data) // 处理 Server 显式用量事件
  if (event.name === 'context') {
    session.contextTokens = event.data.used || 0          // 使用 Server 反馈的真实上下文 token
    session.contextLimit = event.data.limit || session.contextLimit // 使用当前模型真实上下文上限
  }
  if (event.name === 'error-retry' && assistant) assistant.error = `${event.data.message} · ${event.data.nextRetryIn}ms` // 原位展示重试反馈
  if (event.name === 'error' && assistant) {
    assistant.error = event.data.message                 // 展示不可恢复错误
    assistant.request.status = 'failed'                  // 请求条进入故障状态
  }

  if (!['finish', 'error'].includes(event.name)) return  // 普通增量继续保持订阅
  if (assistant) {
    assistant.isStreaming = false                        // 终态关闭打字状态
    assistant.request.status = event.data.cancelled ? 'cancelled' : event.name === 'error' ? 'failed' : 'completed' // 映射真实终态
  }
  session.status = 'idle'                                // 输入器恢复发送动作
  Session.syncSummary(session)                           // 列表同步终态
  try { await Session.refresh(sessionID) }               // 用 Server 最终持久化历史校准增量占位
  catch (error) { UI.notify(error.message) }             // 刷新失败保留当前已显示增量
  controller.abort()                                     // 当前执行结束后释放持续 SSE
  if (store.events.controllers[sessionID] === controller) delete store.events.controllers[sessionID] // 清除当前控制器引用
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
  if (typeof output === 'string') return output           // 文本结果直接展示
  return output?.result || JSON.stringify(output ?? '')   // 优先显示工具业务结果
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
    await AgentAPI.decideTool(sessionID, toolCallID, decision) // 恢复等待中的工具
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
    if (file.size > 1048576) { UI.notify(`${file.name} 超过 1 MiB`); continue } // 与 Server 请求上限保持一致
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
  try {
    await AgentAPI.changeHistory(sessionID, 'rollback-checkpoint', { checkpoint }) // Server 同步截断展示和模型历史
    await Session.refresh(sessionID)                     // 重新读取回退预览和可见消息
    return true                                          // 显示回退预览条
  } catch (error) {
    UI.notify(error.message)                             // 展示无存档点或运行冲突
    return false                                         // 保持当前历史
  }
}


// --- 回退用户消息并填回输入框 ---
async function rollbackMessage(sessionID, messageID) {
  try {
    const result = await AgentAPI.changeHistory(sessionID, 'rollback-message', { messageId: messageID }) // Server 暂存目标消息及后续历史
    await Session.refresh(sessionID)                     // 刷新可见历史和撤销摘要
    store.sessions[sessionID].draft = result.content     // 把原用户消息填回输入框
    return true                                          // 显示撤销回退动作
  } catch (error) {
    UI.notify(error.message)                             // 展示目标不存在或运行冲突
    return false                                         // 保持当前历史
  }
}


// --- 撤销最近回退 ---
async function undoRollback(sessionID) {
  try {
    await AgentAPI.changeHistory(sessionID, 'undo')      // Server 恢复暂存的两套历史
    await Session.refresh(sessionID)                     // 刷新完整时间线
    store.sessions[sessionID].draft = ''                 // 撤销消息回退时清除输入原文
    return true                                          // 反馈恢复完成
  } catch (error) {
    UI.notify(error.message)                             // 展示没有可撤销回退等错误
    return false                                         // 保持当前状态
  }
}


export const Chat = { current, submitInput, send, receive, stop, decide, attach, removeFile, rollback, rollbackMessage, undoRollback } // 暴露全部对话动作
