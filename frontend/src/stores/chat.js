/*
对话数据仓库：按顶部标签隔离消息、草稿、SSE 流和回退状态。
每个动作固定遵循“用户触发 → HTTP 指令 → 对应会话数据 → 当前标签反馈”。
调用示例：await chat.send('检查项目')、await chat.rollbackMessage(message)。
*/
import { computed, reactive } from 'vue'              // 引入按标签隔离的响应式会话上下文
import { defineStore } from 'pinia'                   // 引入 Pinia 数据仓库定义能力
import { AgentAPI } from '../api.js'                  // 引入对话与 checkpoint HTTP 指令
import { readSSE } from '../utils/sse.js'             // 引入 SSE 协议解析能力
import { useTabStore } from './tabs.js'               // 引入当前顶部标签和草稿升级动作


// --- 创建空白标签上下文 ---
function createConversation() {
  return reactive({                                   // 每个标签拥有完全独立的运行时数据
    sessionID: '',                                    // Server 会话 ID，草稿发送后补齐
    messages: [],                                     // 用户、助手和工具展示时间线
    approvals: [],                                    // 正在等待决定的工具调用
    rollback: null,                                   // 暂存回退摘要控制撤销栏
    draftText: '',                                    // 切换标签时保留输入内容
    isRunning: false,                                 // 当前标签 Agent 循环状态
    retryNotice: null,                                // 当前标签连接重试信息
    errorMessage: '',                                 // 当前标签不可恢复错误
    stopSignal: null,                                 // 当前标签 SSE 本地中断信号
    loaded: false,                                    // 避免重复请求已经打开的历史
  })
}


export const useChatStore = defineStore('chat', () => { // 导出唯一对话仓库
  const tabs = useTabStore()                          // 读取顶部当前标签
  const conversations = reactive({})                 // 标签键到独立对话上下文的映射


  // --- 取得指定标签上下文 ---
  function getConversation(key = tabs.activeKey) {
    const conversationKey = key || 'detached'         // 主页未选标签时使用不可见占位上下文
    conversations[conversationKey] ??= createConversation() // 首次打开时按需创建
    return conversations[conversationKey]             // 反馈后续动作持续修改的同一代理
  }


  const activeConversation = computed(() => getConversation()) // 当前标签所有派生字段的唯一来源
  const sessionID = computed(() => activeConversation.value.sessionID) // 当前 Server 会话 ID
  const messages = computed(() => activeConversation.value.messages)   // 当前展示时间线
  const approvals = computed(() => activeConversation.value.approvals) // 当前审批集合
  const rollbackState = computed(() => activeConversation.value.rollback) // 当前可撤销回退
  const isRunning = computed(() => activeConversation.value.isRunning) // 当前运行状态
  const retryNotice = computed(() => activeConversation.value.retryNotice) // 当前重试反馈
  const errorMessage = computed(() => activeConversation.value.errorMessage) // 当前错误反馈
  const hasMessages = computed(() => activeConversation.value.messages.length > 0) // 当前是否显示历史
  const draftText = computed({                         // 输入器通过 v-model 修改当前标签草稿
    get: () => activeConversation.value.draftText,     // 切换时立即读取对应草稿
    set: (value) => { activeConversation.value.draftText = value }, // 输入只写当前上下文
  })


  // --- 判断标签是否已有运行时上下文 ---
  function hasConversation(key) {
    return Boolean(conversations[key]?.loaded)         // App 据此避免重复加载历史
  }


  // --- 加载已有会话 ---
  function loadSession(session, key = tabs.activeKey) {
    const conversation = getConversation(key)         // 取得目标标签而非假设当前标签未切换
    conversation.sessionID = session?.id ?? ''        // 使用选中会话 ID 或保持草稿
    conversation.messages = session?.messages ?? []   // 用 Server 可见历史替换当前展示
    conversation.rollback = session?.rollback ?? null // 恢复服务重启后仍可撤销的回退
    conversation.approvals = []                       // 历史加载不恢复已失效审批
    conversation.retryNotice = null                   // 新上下文清除重试反馈
    conversation.errorMessage = ''                    // 新上下文清除旧错误
    conversation.loaded = true                        // 标记详情已经读取
    return conversation                               // 反馈调用方继续设置草稿
  }


  // --- 删除标签运行时上下文 ---
  function removeConversation(key) {
    const conversation = conversations[key]           // 查找关闭标签对应的数据
    if (conversation?.isRunning) return false          // 运行中标签必须保留流和审批入口
    delete conversations[key]                         // 非运行上下文可安全释放
    return true                                       // 反馈标签关闭可继续
  }


  // --- 创建流式助手消息 ---
  function addAssistantDraft(conversation) {
    conversation.messages.push({ role: 'assistant', content: '', reasoning: '', isStreaming: true }) // 在目标时间线末尾创建草稿
    return conversation.messages[conversation.messages.length - 1] // 返回 Vue 响应式代理供增量修改
  }


  // --- 取得当前流式助手消息 ---
  function getAssistantDraft(conversation, streamState) {
    streamState.assistant ??= addAssistantDraft(conversation) // 工具结果后的文本创建独立助手轮次
    return streamState.assistant                              // 反馈当前模型段落代理
  }


  // --- 按工具调用 ID 查找时间线项 ---
  function getToolMessage(conversation, toolCallID) {
    return conversation.messages.find((message) => message.role === 'tool' && message.toolCallId === toolCallID) // 只查当前流所属会话
  }


  // --- 将工具调用插入消息时间线 ---
  function addToolMessage(conversation, data, streamState) {
    const assistant = streamState.assistant           // 读取工具之前的助手段落
    if (assistant) assistant.isStreaming = false      // 工具声明结束前一段输出
    if (assistant && !assistant.content && !assistant.reasoning) conversation.messages.pop() // 纯工具响应不保留空气泡
    conversation.messages.push({ role: 'tool', toolCallId: data.toolCallId, name: data.toolName, input: data.input, result: null, status: 'running', isStreaming: true }) // 工具原位进入时间线
    streamState.assistant = null                      // 工具之后的文本开始新段落
  }


  // --- 接收一个 SSE 事件 ---
  function receiveEvent(conversation, event, streamState) {
    if (event.name === 'session-created') {           // 草稿首次发送后升级为真实会话
      const previousKey = streamState.tabKey          // 保存迁移前草稿键
      conversation.sessionID = event.data.id          // 写入 Server 创建的真实 ID
      const nextKey = tabs.promote(previousKey, event.data.id) // 标签原位升级
      conversations[nextKey] = conversation           // 新键继续指向正在流式修改的同一代理
      if (nextKey !== previousKey) delete conversations[previousKey] // 移除旧草稿映射
      streamState.tabKey = nextKey                    // 后续标题事件定位真实标签
    }
    if (event.name === 'session-title') tabs.setTitle(streamState.tabKey, event.data.title) // 异步标题立即更新标签
    if (event.name === 'text-delta') getAssistantDraft(conversation, streamState).content += event.data.text ?? event.data.textDelta ?? '' // 每个增量立即修改目标代理
    if (event.name === 'reasoning-delta') getAssistantDraft(conversation, streamState).reasoning += event.data.text ?? event.data.textDelta ?? '' // 每个思考增量立即修改目标代理
    if (event.name === 'tool-call') addToolMessage(conversation, event.data, streamState) // 工具按发生顺序插入
    if (event.name === 'tool-result') {                // 工具执行后补充对应结果
      const toolMessage = getToolMessage(conversation, event.data.toolCallId) // 定位同一调用
      if (toolMessage) Object.assign(toolMessage, { result: event.data.output, status: 'completed', isStreaming: false }) // 原位完成工具反馈
      conversation.approvals = conversation.approvals.filter((item) => item.id !== event.data.toolCallId) // 清理审批
    }
    if (event.name === 'checkpoint') {                 // Server 持久化后下发真实步骤
      event.data.toolCallIds.forEach((toolCallID) => { // 并行工具共享同一步骤
        const toolMessage = getToolMessage(conversation, toolCallID) // 定位实时工具项
        if (toolMessage) toolMessage.step = event.data.step          // 无需刷新即可显示回退动作
      })
    }
    if (event.name === 'tool-approval-request') {      // ask 权限原位展示用户动作
      conversation.approvals.push({ id: event.data.id, name: event.data.name, input: event.data.args }) // 保存待处理项
      const toolMessage = getToolMessage(conversation, event.data.id) // 定位刚插入工具
      if (toolMessage) toolMessage.status = 'waiting' // 切换为等待批准
    }
    if (event.name === 'error-retry') conversation.retryNotice = event.data // 展示无限重试进度
    if (event.name === 'error') conversation.errorMessage = event.data.message // 展示不可恢复错误
    if (event.name === 'finish' && event.data.ok) conversation.messages.forEach((message) => { message.isStreaming = false }) // 仅整个 Agent 完成时关闭状态
  }


  // --- 发送用户消息 ---
  async function send(content) {
    const message = content.trim()                    // 去除输入首尾空白
    const tabKey = tabs.activeKey                     // 捕获触发时标签，切换后流仍写回原处
    const conversation = getConversation(tabKey)      // 捕获本轮独立上下文
    if (!message || conversation.isRunning) return false // 空消息或同标签运行中禁止重复触发

    conversation.draftText = ''                       // 提交成功后清空当前标签输入器
    conversation.rollback = null                      // 新消息会在 Server 正式提交暂存回退
    const messageID = `msg_${crypto.randomUUID()}`     // 前后端共享稳定用户消息 ID
    conversation.messages.push({ id: messageID, role: 'user', content: message }) // 立即反馈用户输入
    const streamState = { assistant: addAssistantDraft(conversation), tabKey } // 保存流归属和当前段落
    conversation.isRunning = true                     // 当前标签切换为停止动作
    conversation.retryNotice = null                   // 清除上次重试信息
    conversation.errorMessage = ''                    // 清除上次错误
    conversation.stopSignal = new AbortController()   // 创建独立中断信号
    try {
      const response = await AgentAPI.sendMessage({ sessionID: conversation.sessionID, messageID, message, signal: conversation.stopSignal.signal }) // 使用同一消息 ID 启动目标会话 API
      await readSSE(response, (event) => receiveEvent(conversation, event, streamState)) // 按网络顺序增量修改捕获上下文
      return true                                     // 反馈完整 SSE 已消费
    } catch (error) {
      if (error.name !== 'AbortError') conversation.errorMessage = error.message // 主动中断不显示网络错误
      return false                                    // 反馈任务没有自然完成
    } finally {
      conversation.messages.forEach((item) => { item.isStreaming = false }) // 异常或中断后关闭实时状态
      conversation.isRunning = false                  // 恢复当前标签发送动作
      conversation.stopSignal = null                  // 释放本轮信号
    }
  }


  // --- 中断当前标签 Agent ---
  async function stop() {
    const conversation = getConversation()            // 读取当前标签运行状态
    if (!conversation.isRunning || !conversation.sessionID) return false // 没有运行任务时无需请求
    conversation.retryNotice = null                   // 用户主动停止立即清除连接重试反馈
    const result = await AgentAPI.stopChat(conversation.sessionID) // 中断对应 Server 循环
    conversation.stopSignal?.abort()                  // 关闭同一标签浏览器 SSE
    return result.ok                                  // 反馈是否命中任务
  }


  // --- 批准当前标签工具 ---
  async function approve(toolCallID) {
    const conversation = getConversation()            // 捕获审批所属当前标签
    const toolMessage = getToolMessage(conversation, toolCallID) // 查找原位工具项
    if (toolMessage) toolMessage.status = 'approving' // 立即反馈提交状态
    const result = await AgentAPI.approveTool(conversation.sessionID, toolCallID) // 恢复 Server 工具
    if (result.ok) {
      conversation.approvals = conversation.approvals.filter((item) => item.id !== toolCallID) // 消费审批
      if (toolMessage) toolMessage.status = 'running' // 反馈真实执行中
    } else if (toolMessage) toolMessage.status = 'waiting' // 失败恢复可重试状态
    return result.ok                                  // 反馈审批结果
  }


  // --- 拒绝当前标签工具 ---
  async function reject(toolCallID) {
    const conversation = getConversation()            // 捕获拒绝所属当前标签
    const toolMessage = getToolMessage(conversation, toolCallID) // 查找原位工具项
    if (toolMessage) toolMessage.status = 'rejecting' // 立即反馈提交状态
    const result = await AgentAPI.rejectTool(conversation.sessionID, toolCallID) // 拒绝 Server 工具
    if (result.ok) {
      conversation.approvals = conversation.approvals.filter((item) => item.id !== toolCallID) // 消费审批
      if (toolMessage) toolMessage.status = 'rejected' // 保留拒绝结果位置
    } else if (toolMessage) toolMessage.status = 'waiting' // 失败恢复可重试状态
    return result.ok                                  // 反馈拒绝结果
  }


  // --- 重新读取回退后的真实历史 ---
  async function reloadAfterRollback(conversation, tabKey, draft = '') {
    const session = await AgentAPI.getSession(conversation.sessionID) // 读取 Server 暂存边界后的可见历史
    const reloaded = loadSession(session, tabKey)      // 同步准确标签的消息和撤销摘要
    reloaded.draftText = draft                         // 用户消息回退时恢复原文
    return true                                        // 反馈界面同步完成
  }


  // --- 回退到工具步骤 ---
  async function rollback(step) {
    const tabKey = tabs.activeKey                     // 捕获触发标签避免请求期间切换串写
    const conversation = getConversation()            // 读取当前标签上下文
    if (!conversation.sessionID || conversation.isRunning) return false // 运行中禁止竞争修改
    const result = await AgentAPI.rollbackSession(conversation.sessionID, step) // 暂存 checkpoint 后历史
    if (!result.ok) return false                       // Server 拒绝时保持当前界面
    return reloadAfterRollback(conversation, tabKey)   // 重新读取真实边界和撤销摘要
  }


  // --- 回退用户消息并恢复到输入框 ---
  async function rollbackMessage(message) {
    const tabKey = tabs.activeKey                     // 捕获触发标签避免请求期间切换串写
    const conversation = getConversation()            // 读取当前标签上下文
    if (!message.id || !conversation.sessionID || conversation.isRunning) return false // 无稳定目标或运行中拒绝
    const result = await AgentAPI.rollbackMessage(conversation.sessionID, message.id) // 暂存目标消息及之后历史
    if (!result.ok) return false                       // Server 拒绝时保持时间线
    return reloadAfterRollback(conversation, tabKey, result.content) // 隐藏旧分支并预填原文
  }


  // --- 撤销当前暂存回退 ---
  async function undoRollback() {
    const tabKey = tabs.activeKey                     // 捕获触发标签避免请求期间切换串写
    const conversation = getConversation()            // 读取当前可撤销上下文
    if (!conversation.rollback || conversation.isRunning) return false // 没有暂存或运行中无需调用
    const result = await AgentAPI.undoRollback(conversation.sessionID) // 恢复 Server 两套历史
    if (!result.ok) return false                       // 恢复失败保留提示状态
    return reloadAfterRollback(conversation, tabKey)   // 清空输入草稿并显示完整历史
  }


  return { sessionID, messages, approvals, rollbackState, draftText, isRunning, retryNotice, errorMessage, hasMessages, hasConversation, loadSession, removeConversation, send, stop, approve, reject, rollback, rollbackMessage, undoRollback } // 暴露当前标签数据与指令
})
