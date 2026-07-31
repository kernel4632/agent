/*
对话指令：负责每个标签的消息、SSE、审批、任务、停止和回滚动作。
所有对话数据存放在 store.js；本指令捕获触发时标签，保证后台流不会串写当前页面。
调用示例：await Chat.send('检查项目')、Chat.loadSession(session, tabKey)、await Chat.rollback(step)。
*/
import { AgentAPI } from '../api.js'                               // 引入对话与回滚 HTTP 指令
import { createConversationData, store } from '../store.js'            // 引入全局对话结构和标签身份数据
import { readSSE } from '../utils/sse.js'                          // 引入通用 SSE 协议解析工具
import { Tabs } from './tabs.js'                                   // 引入标签升级和标题指令


// --- 取得一个标签的对话数据 ---
function getConversation(key = store.tabs.activeKey) {
  const conversationKey = key || 'detached'                        // 主页未选标签时使用不可见占位身份
  store.chat.conversations[conversationKey] ??= createConversationData() // 首次访问时建立完整默认结构
  return store.chat.conversations[conversationKey]                  // 返回后续指令修改的同一响应式数据
}


// --- 判断标签是否已有会话详情 ---
function hasConversation(key) {
  return Boolean(store.chat.conversations[key]?.loaded)             // 已加载详情的标签无需重复请求
}


// --- 读取标签后台状态 ---
function getStatus(key) {
  const conversation = store.chat.conversations[key]               // 未加载标签不创建无用数据
  return { running: Boolean(conversation?.isRunning), approval: Boolean(conversation?.approvals.length) } // 返回标签需要的活动反馈
}


// --- 修改当前标签输入草稿 ---
function setDraftText(value) {
  const conversation = getConversation()                           // 读取当前标签对话数据
  conversation.draftText = value                                   // 只修改当前标签的输入内容
}


// --- 提交输入组件内容 ---
function submitInput(content, isRunning, emit) {
  const message = content.value.trim()                             // 去除无意义首尾空白
  if (!message || isRunning) return false                          // 空文本或运行中拒绝重复提交
  content.value = ''                                               // 清空当前标签输入反馈
  emit('send', message)                                            // 将有效消息交给聊天页面入口
  return true                                                      // 返回入口可以恢复输入焦点
}


// --- 切换思考内容展开状态 ---
function toggleReasoning(isOpen) {
  isOpen.value = !isOpen.value                                     // 反转当前消息的 reasoning 可见状态
}


// --- 加载一个会话到指定标签 ---
function loadSession(session, key = store.tabs.activeKey) {
  const conversation = getConversation(key)                        // 取得目标标签而非假设当前标签未切换
  conversation.sessionID = session?.id ?? ''                       // 使用真实会话 ID 或保持草稿
  conversation.messages = session?.messages ?? []                  // 用 Server 可见历史替换时间线
  conversation.tasks = session?.tasks ?? []                        // 恢复持久化任务清单
  conversation.taskRevision = session?.taskRevision ?? 0           // 恢复任务并发修订号
  conversation.rollback = session?.rollback ?? null                // 恢复服务重启后仍可撤销的回退
  conversation.approvals = []                                      // 历史加载不恢复已失效审批
  conversation.retryNotice = null                                  // 新上下文清除重试反馈
  conversation.errorMessage = ''                                   // 新上下文清除旧错误
  conversation.loaded = true                                       // 标记详情已经读取
  return conversation                                               // 返回数据供工作区继续使用
}


// --- 删除一个标签的对话数据 ---
function removeConversation(key) {
  const chatStore = store.chat                                      // 读取全部标签对话映射
  const conversation = chatStore.conversations[key]                // 查找关闭标签对应的数据
  if (conversation?.isRunning) return false                         // 运行中标签必须保留流和审批入口
  delete chatStore.conversations[key]                              // 释放非运行标签的浏览器数据
  return true                                                       // 返回标签可以继续关闭
}


// --- 创建流式助手消息 ---
function addAssistantDraft(conversation) {
  conversation.messages.push({ role: 'assistant', content: '', reasoning: '', isStreaming: true }) // 在时间线末尾创建模型草稿
  return conversation.messages[conversation.messages.length - 1]   // 返回响应式消息供增量写入
}


// --- 取得当前流式助手消息 ---
function getAssistantDraft(conversation, streamState) {
  streamState.assistant ??= addAssistantDraft(conversation)        // 工具结果后的文本创建独立助手轮次
  return streamState.assistant                                     // 返回当前模型段落数据
}


// --- 查找一个工具时间线项 ---
function getToolMessage(conversation, toolCallID) {
  return conversation.messages.find((message) => message.role === 'tool' && message.toolCallId === toolCallID) // 只在本轮所属会话中查找
}


// --- 插入一个工具调用 ---
function addToolMessage(conversation, data, streamState) {
  const assistant = streamState.assistant                         // 读取工具之前的助手段落
  if (assistant) assistant.isStreaming = false                    // 工具声明结束前一段输出
  if (assistant && !assistant.content && !assistant.reasoning) conversation.messages.pop() // 纯工具响应不保留空消息
  conversation.messages.push({ role: 'tool', toolCallId: data.toolCallId, name: data.toolName, input: data.input, result: null, status: 'running', isStreaming: true }) // 工具原位进入时间线
  streamState.assistant = null                                    // 工具之后的文本开始新段落
}


// --- 接收一个 SSE 事件 ---
function receiveEvent(conversation, event, streamState) {
  if (event.name === 'session-created') {                          // 草稿首次发送后升级为真实会话
    const previousKey = streamState.tabKey                         // 保存迁移前草稿身份
    conversation.sessionID = event.data.id                         // 写入 Server 创建的真实 ID
    const nextKey = Tabs.promote(previousKey, event.data.id)       // 标签原位升级为真实会话
    store.chat.conversations[nextKey] = conversation                // 新身份继续指向同一流式数据
    if (nextKey !== previousKey) delete store.chat.conversations[previousKey] // 清理旧草稿映射
    streamState.tabKey = nextKey                                   // 后续标题事件定位真实标签
  }
  if (event.name === 'session-title') Tabs.setTitle(streamState.tabKey, event.data.title) // 异步标题立即更新顶部标签
  if (event.name === 'text-delta') getAssistantDraft(conversation, streamState).content += event.data.text ?? event.data.textDelta ?? '' // 文本增量写入当前段落
  if (event.name === 'reasoning-delta') getAssistantDraft(conversation, streamState).reasoning += event.data.text ?? event.data.textDelta ?? '' // 思考增量写入当前段落
  if (event.name === 'tool-call') addToolMessage(conversation, event.data, streamState) // 工具按发生顺序进入时间线
  if (event.name === 'tool-result') {                              // 工具完成后补充对应结果
    const toolMessage = getToolMessage(conversation, event.data.toolCallId) // 定位同一工具调用
    if (toolMessage) Object.assign(toolMessage, { result: event.data.output, status: event.data.output?.denied ? 'rejected' : 'completed', isStreaming: false }) // 保留拒绝或完成语义
    conversation.approvals = conversation.approvals.filter((item) => item.id !== event.data.toolCallId) // 清理已完成审批
  }
  if (event.name === 'checkpoint') {                              // Server 持久化后下发真实步骤
    event.data.toolCallIds.forEach((toolCallID) => {
      const toolMessage = getToolMessage(conversation, toolCallID) // 定位同一步骤中的工具项
      if (toolMessage) toolMessage.step = event.data.step          // 无需刷新即可显示回退动作
    })
  }
  if (event.name === 'tool-approval-request') {                    // ask 权限进入原位用户动作
    const approval = { id: event.data.id, name: event.data.name, input: event.data.args, matchedRule: event.data.matchedRule, scope: event.data.scope, target: event.data.target } // 保存权限匹配详情
    conversation.approvals.push(approval)                          // 标签状态据此显示待审批反馈
    const toolMessage = getToolMessage(conversation, event.data.id) // 定位刚插入的工具项
    if (toolMessage) Object.assign(toolMessage, approval, { status: 'waiting', approvalError: '' }) // 工具原位展示审批动作
  }
  if (event.name === 'task-list-updated') {                        // 工具更新后刷新任务面板
    conversation.tasks = event.data.tasks ?? []                    // 使用 Server 验证后的完整清单
    conversation.taskRevision = event.data.taskRevision ?? conversation.taskRevision // 保存同一事件的修订号
  }
  if (event.name === 'error-retry') conversation.retryNotice = event.data // 展示连接重试进度
  if (event.name === 'error') conversation.errorMessage = event.data.message // 展示不可恢复错误
  if (event.name === 'finish' && event.data.ok) conversation.messages.forEach((message) => { message.isStreaming = false }) // 整个 Agent 完成后关闭流状态
}


// --- 发送一条用户消息 ---
async function send(content) {
  const message = content.trim()                                  // 去除输入首尾空白
  const tabKey = store.tabs.activeKey                               // 捕获触发时标签，切换后仍写回原处
  const conversation = getConversation(tabKey)                    // 捕获本轮独立对话数据
  if (!message || conversation.isRunning) return false            // 空消息或同标签运行中拒绝重复触发

  conversation.draftText = ''                                     // 提交后清空当前标签输入器
  conversation.rollback = null                                    // 新消息将由 Server 正式提交回退边界
  const messageID = `msg_${crypto.randomUUID()}`                   // 前后端共享稳定用户消息 ID
  conversation.messages.push({ id: messageID, role: 'user', content: message }) // 立即反馈用户输入
  const streamState = { assistant: addAssistantDraft(conversation), tabKey } // 保存流归属和当前段落
  conversation.isRunning = true                                   // 当前标签切换为停止动作
  conversation.retryNotice = null                                 // 清除上次重试信息
  conversation.errorMessage = ''                                  // 清除上次错误
  conversation.stopSignal = new AbortController()                 // 创建独立 SSE 中断信号
  try {
    const response = await AgentAPI.sendMessage({ sessionID: conversation.sessionID, messageID, message, signal: conversation.stopSignal.signal }) // 启动目标会话 Agent
    await readSSE(response, (event) => receiveEvent(conversation, event, streamState)) // 按网络顺序修改捕获数据
    return true                                                    // 返回完整 SSE 已消费
  } catch (error) {
    if (error.name !== 'AbortError') conversation.errorMessage = error.message // 主动停止不显示网络错误
    return false                                                   // 返回任务没有自然完成
  } finally {
    conversation.messages.forEach((item) => { item.isStreaming = false }) // 异常或中断后关闭实时状态
    conversation.isRunning = false                                // 恢复当前标签发送动作
    conversation.stopSignal = null                                // 释放本轮中断信号
  }
}


// --- 停止当前标签 Agent ---
async function stop() {
  const conversation = getConversation()                           // 读取当前标签运行数据
  if (!conversation.isRunning || !conversation.sessionID) return false // 没有运行任务时无需请求
  conversation.retryNotice = null                                  // 用户主动停止立即清除重试反馈
  const result = await AgentAPI.stopChat(conversation.sessionID)   // 中断对应 Server 循环
  conversation.stopSignal?.abort()                                 // 关闭同一标签浏览器 SSE
  return result.ok                                                  // 返回是否命中运行任务
}


// --- 决定一个工具权限请求 ---
async function decide(toolCallID, decision) {
  const conversation = getConversation()                           // 捕获审批所属当前标签
  const toolMessage = getToolMessage(conversation, toolCallID)     // 查找原位工具项
  if (!['deny', 'allow-once', 'always-allow'].includes(decision) || !conversation.sessionID) return false // 无效决定不能恢复 Server
  if (toolMessage) Object.assign(toolMessage, { status: 'deciding', approvalError: '' }) // 禁用动作并反馈提交中
  try {
    const result = await AgentAPI.decideTool(conversation.sessionID, toolCallID, decision) // 提交精确三选一决定
    conversation.approvals = conversation.approvals.filter((item) => item.id !== toolCallID) // 清除标签审批提示
    if (toolMessage) toolMessage.status = decision === 'deny' ? 'rejected' : 'running' // 原位反馈拒绝或继续
    return result.ok                                                // 返回审批已被 Server 接受
  } catch (error) {
    if (toolMessage) Object.assign(toolMessage, { status: 'waiting', approvalError: error.message }) // 失败后恢复可重试状态
    return false                                                   // 保持 SSE 等待再次决定
  }
}


// --- 重新读取回退后的真实历史 ---
async function reloadAfterRollback(conversation, tabKey, draft = '') {
  const session = await AgentAPI.getSession(conversation.sessionID) // 读取 Server 暂存边界后的历史
  const reloaded = loadSession(session, tabKey)                      // 同步准确标签的数据
  reloaded.draftText = draft                                        // 用户消息回退时恢复原文
  return true                                                       // 返回界面同步完成
}


// --- 回退到一个工具步骤 ---
async function rollback(step) {
  const tabKey = store.tabs.activeKey                                // 捕获触发标签避免请求期间串写
  const conversation = getConversation(tabKey)                     // 读取当前标签对话数据
  if (!conversation.sessionID || conversation.isRunning) return false // 运行中或无会话时拒绝竞争修改
  const result = await AgentAPI.rollbackSession(conversation.sessionID, step) // 暂存 checkpoint 后历史
  if (!result.ok) return false                                      // Server 拒绝时保持当前界面
  return reloadAfterRollback(conversation, tabKey)                  // 显示真实回退边界
}


// --- 回退一条用户消息 ---
async function rollbackMessage(message) {
  const tabKey = store.tabs.activeKey                                 // 捕获触发标签避免请求期间串写
  const conversation = getConversation(tabKey)                      // 读取当前标签对话数据
  if (!message.id || !conversation.sessionID || conversation.isRunning) return false // 无稳定目标或运行中拒绝
  const result = await AgentAPI.rollbackMessage(conversation.sessionID, message.id) // 暂存目标消息及之后历史
  if (!result.ok) return false                                       // Server 拒绝时保持当前界面
  return reloadAfterRollback(conversation, tabKey, result.content)   // 隐藏旧分支并恢复输入原文
}


// --- 撤销当前暂存回退 ---
async function undoRollback() {
  const tabKey = store.tabs.activeKey                                // 捕获触发标签避免请求期间串写
  const conversation = getConversation(tabKey)                      // 读取当前可撤销数据
  if (!conversation.rollback || conversation.isRunning) return false // 没有暂存或运行中无需调用
  const result = await AgentAPI.undoRollback(conversation.sessionID) // 恢复 Server 两套历史
  if (!result.ok) return false                                       // 恢复失败时保留提示状态
  return reloadAfterRollback(conversation, tabKey)                   // 显示恢复后的完整历史
}


export const Chat = { getConversation, hasConversation, getStatus, setDraftText, submitInput, toggleReasoning, loadSession, removeConversation, send, stop, decide, rollback, rollbackMessage, undoRollback } // 暴露全部对话指令
