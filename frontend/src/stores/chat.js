/*
对话数据仓库：发送消息、消费真实 SSE、修改消息历史，并处理工具审批、中断与回滚反馈。
每个流事件只修改对应业务字段，让“用户触发 → Agent 指令 → 消息数据 → 界面反馈”可以局部追踪。
调用示例：await chat.send('检查项目')、await chat.approve(toolCallID)。
*/
import { computed, ref } from 'vue'                 // 引入响应式消息和派生状态
import { defineStore } from 'pinia'                 // 引入 Pinia 数据仓库定义能力
import { AgentAPI } from '../api.js'                // 引入对话与 checkpoint HTTP 指令
import { readSSE } from '../utils/sse.js'           // 引入 SSE 协议解析能力

export const useChatStore = defineStore('chat', () => { // 导出唯一对话仓库
  const sessionID = ref('')                         // 当前对话对应的 Server 会话 ID
  const messages = ref([])                          // 用户、助手和工具的完整展示消息
  const approvals = ref([])                         // 正在等待用户决定的工具调用
  const isRunning = ref(false)                      // Agent 循环运行状态
  const retryNotice = ref(null)                     // API 失败后的当前重试信息
  const errorMessage = ref('')                      // 最近一次不可恢复错误
  const stopSignal = ref(null)                      // 当前 SSE 请求的本地中断信号
  const hasMessages = computed(() => messages.value.length > 0) // 决定显示欢迎页或对话历史


  // --- 加载已有会话 ---
  function loadSession(session) {
    sessionID.value = session?.id ?? ''             // 使用选中会话 ID 或清空上下文
    messages.value = session?.messages ?? []        // 用 Server 完整历史替换当前展示
    approvals.value = []                            // 历史会话不保留旧审批弹窗
    retryNotice.value = null                        // 新上下文清除重试反馈
    errorMessage.value = ''                         // 新上下文清除旧错误
  }


  // --- 创建流式助手消息 ---
  function addAssistantDraft() {
    const draft = { role: 'assistant', content: '', reasoning: '', toolCalls: [], isStreaming: true } // 显式定义流式消息结构
    messages.value.push(draft)                    // 将助手反馈放到用户消息之后
    return draft                                  // 反馈可持续修改的响应式引用
  }


  // --- 接收一个 SSE 事件 ---
  async function receiveEvent(event, draft) {
    if (event.name === 'session-created') sessionID.value = event.data.id // 自动创建会话后保存真实 ID
    if (event.name === 'text-delta') draft.content += event.data.text ?? event.data.textDelta ?? '' // 累加文本增量
    if (event.name === 'reasoning-delta') draft.reasoning += event.data.text ?? event.data.textDelta ?? '' // 累加思考增量
    if (event.name === 'tool-call') draft.toolCalls.push({ id: event.data.toolCallId, name: event.data.toolName, input: event.data.input, output: null }) // 添加工具声明
    if (event.name === 'tool-result') {                                    // 工具执行后补充对应结果
      const toolCall = draft.toolCalls.find((item) => item.id === event.data.toolCallId) // 查找同一工具调用
      if (toolCall) toolCall.output = event.data.output                    // 将真实执行结果写回工具项
    }
    if (event.name === 'tool-approval-request') approvals.value.push({ id: event.data.id, name: event.data.name, input: event.data.args }) // 展示审批请求
    if (event.name === 'error-retry') retryNotice.value = event.data      // 展示无限重试进度
    if (event.name === 'error') errorMessage.value = event.data.message   // 展示不可恢复错误
    if (event.name === 'finish') draft.isStreaming = false                // Server 明确完成时停止光标动画
  }


  // --- 发送用户消息 ---
  async function send(content) {
    const message = content.trim()                        // 去除输入首尾空白
    if (!message || isRunning.value) return false         // 空消息或运行中禁止重复触发

    messages.value.push({ role: 'user', content: message }) // 立即展示用户输入
    const draft = addAssistantDraft()                     // 准备接收本轮流式反馈
    isRunning.value = true                                // 输入器切换为停止按钮
    retryNotice.value = null                              // 新任务清除上次重试信息
    errorMessage.value = ''                               // 新任务清除上次错误
    stopSignal.value = new AbortController()              // 为本轮 HTTP 流创建独立中断信号
    try {
      const response = await AgentAPI.sendMessage({ sessionID: sessionID.value, message, signal: stopSignal.value.signal }) // 启动真实 Agent API
      await readSSE(response, (event) => receiveEvent(event, draft)) // 按顺序修改对话数据
      return true                                         // 反馈完整 SSE 已消费
    } catch (error) {
      if (error.name !== 'AbortError') errorMessage.value = error.message // 主动中断不显示网络错误
      return false                                        // 反馈任务没有自然完成
    } finally {
      draft.isStreaming = false                           // 确保异常或中断后关闭流式状态
      isRunning.value = false                             // 恢复输入器发送动作
      stopSignal.value = null                             // 释放本轮中断信号
    }
  }


  // --- 中断当前 Agent ---
  async function stop() {
    if (!isRunning.value || !sessionID.value) return false // 没有运行会话时无需请求 Server
    const result = await AgentAPI.stopChat(sessionID.value) // 中断 Server 中的真实模型循环
    stopSignal.value?.abort()                              // 关闭浏览器本地 SSE 读取
    return result.ok                                      // 反馈 Server 是否命中运行任务
  }


  // --- 批准工具调用 ---
  async function approve(toolCallID) {
    const result = await AgentAPI.approveTool(sessionID.value, toolCallID) // 恢复 Server 挂起工具
    if (result.ok) approvals.value = approvals.value.filter((item) => item.id !== toolCallID) // 移除已处理审批
    return result.ok                                      // 反馈审批结果
  }


  // --- 拒绝工具调用 ---
  async function reject(toolCallID) {
    const result = await AgentAPI.rejectTool(sessionID.value, toolCallID) // 拒绝 Server 挂起工具
    if (result.ok) approvals.value = approvals.value.filter((item) => item.id !== toolCallID) // 移除已处理审批
    return result.ok                                      // 反馈拒绝结果
  }


  // --- 回滚到工具步骤 ---
  async function rollback(step) {
    if (!sessionID.value) return false                    // 无当前会话时不能回滚
    const result = await AgentAPI.rollbackSession(sessionID.value, step) // 截断 Server 消息历史
    return result.ok                                      // 由视图在成功后重新加载详情
  }


  return { sessionID, messages, approvals, isRunning, retryNotice, errorMessage, hasMessages, loadSession, send, stop, approve, reject, rollback } // 暴露对话数据与指令
})
