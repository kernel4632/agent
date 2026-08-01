/*
对话指令：负责本地消息、流式演示、停止、审批、附件和回退。
所有动作先形成完整前端反馈；未来 API 只替换对应 TODO 段落。
调用示例：Chat.send(sessionID)、Chat.stop(sessionID)、Chat.decide(sessionID, toolCallID, decision)。
*/
import { store } from '../store.js'                                  // 引入完整 Session 和配置目录
import { Session } from './session.js'                               // 引入摘要同步与模型选择
import { UI } from './ui.js'                                         // 引入复制和轻反馈
import { t } from '../i18n.js'                                       // 引入当前语言演示和反馈文案

const simulations = new Map()                                        // Session ID 到本地流式演示计时器


// --- 读取当前 Session ---
function current() {
  return store.sessions[store.ui.activeSessionID] || null             // 页面只消费当前活动会话
}


// --- 提交输入内容 ---
function submitInput(content, isRunning, emit) {
  const text = content.value.trim()                                   // 空白输入没有业务含义
  if (!text || isRunning) return false                                // 运行中拒绝重复发送
  content.value = ''                                                  // 触发成功后立即清空输入
  emit('send', text)                                                  // 把有效消息交给页面指令
  return true                                                         // 输入组件恢复焦点
}


// --- 发送用户消息 ---
function send(sessionID, content) {
  const session = store.sessions[sessionID]                           // 读取目标会话
  const text = content.trim()                                         // 消息不保留无意义首尾空白
  if (!session || !text || session.status === 'running') return false // 无会话、空文本和重复发送均拒绝

  // TODO(API): POST /session/chat，提交 sessionId、content、messageId 和 files；实时反馈改由 /session/events 写入同一 Store。
  const userMessage = { id: `message-${crypto.randomUUID()}`, role: 'user', content: text, files: [...session.files], createdAt: Date.now() }
  const assistant = {
    id: `message-${crypto.randomUUID()}`, role: 'assistant', content: '', reasoning: '', tools: [], createdAt: Date.now(), isStreaming: true,
    request: { status: 'running', input: 0, output: 0, cache: 0, duration: 0 },
  }
  session.rollback = null                                             // 新消息正式提交当前回退分支
  session.files = []                                                  // 附件归属用户消息后清空输入区
  session.messages.push(userMessage, assistant)                       // 用户输入和响应占位即时进入时间线
  session.status = 'running'                                          // 输入器切换为停止按钮
  session.updatedAt = Date.now()                                      // 会话进入最近活动
  syncSummary(session)                                                 // 侧边栏和主页同步计数
  simulateResponse(session, assistant)                                 // 使用本地数据演示完整流式响应
  return true                                                          // 反馈发送动作已接受
}


// --- 演示流式 Agent 响应 ---
function simulateResponse(session, assistant) {
  const chunks = [
    t('simulationStart'),
    t('simulationState'),
    t('simulationApi'),
  ]
  const startedAt = performance.now()                                  // 请求状态条使用真实演示耗时
  let index = 0                                                        // 记录下一段文本位置
  const timer = window.setInterval(() => {
    if (index < chunks.length) {
      assistant.content += chunks[index]                               // 增量文本触发 Markdown 和滚动反馈
      assistant.request.output += 96 + index * 44                      // 模拟 usage 持续增长
      index += 1                                                       // 推进到下一段
      return                                                           // 等待下一次流式更新
    }

    window.clearInterval(timer)                                        // 文本完成后结束计时器
    simulations.delete(session.id)                                     // 释放当前 Session 演示控制
    assistant.isStreaming = false                                      // 关闭打字和请求旋转状态
    assistant.request.status = 'completed'                              // 请求条展示 usage
    assistant.request.input = Math.max(620, Math.round(assistant.content.length * 1.8)) // 提供可读估算
    assistant.request.cache = Math.round(assistant.request.input * 0.35) // 模拟缓存读取
    assistant.request.duration = Number(((performance.now() - startedAt) / 1000).toFixed(1)) // 反馈完整耗时
    session.contextTokens += assistant.request.input + assistant.request.output // 更新上下文圆环
    session.inputTokens += assistant.request.input                      // 更新累计输入
    session.outputTokens += assistant.request.output                    // 更新累计输出
    session.cacheTokens += assistant.request.cache                      // 更新累计缓存
    session.status = 'idle'                                             // 输入器恢复发送动作
    syncSummary(session)                                                 // 同步列表摘要
  }, 520)
  simulations.set(session.id, timer)                                    // 停止按钮据此取消流式演示
}


// --- 停止当前执行 ---
function stop(sessionID) {
  const session = store.sessions[sessionID]                             // 读取目标会话
  if (!session || session.status !== 'running') return false            // 非运行状态无需停止

  // TODO(API): POST /session/stop，请求体携带 sessionId；SSE 最终事件负责写入终态。
  window.clearInterval(simulations.get(sessionID))                      // 停止本地流式演示
  simulations.delete(sessionID)                                         // 释放控制句柄
  const assistant = [...session.messages].reverse().find((item) => item.role === 'assistant' && item.isStreaming) // 找到当前响应
  if (assistant) {
    assistant.isStreaming = false                                       // 关闭打字状态
    assistant.request.status = 'cancelled'                               // 请求条反馈主动暂停
  }
  session.status = 'idle'                                                // 输入器恢复发送按钮
  UI.notify(t('generationPaused'))                                     // 明确反馈停止动作
  return true                                                            // 反馈命中当前执行
}


// --- 处理工具审批 ---
function decide(sessionID, toolCallID, decision) {
  const session = store.sessions[sessionID]                              // 读取审批所属会话
  const tool = session?.messages.flatMap((item) => item.tools || []).find((item) => item.id === toolCallID) // 定位原位工具条
  if (!tool || !['deny', 'allow-once', 'always-allow'].includes(decision)) return false // 无效决定不修改数据

  // TODO(API): POST /session/approval，提交 sessionId、toolCallId 和 decision。
  tool.decision = decision                                               // 保存本次用户决定
  tool.status = decision === 'deny' ? 'rejected' : 'completed'          // 原位切换拒绝或完成反馈
  tool.preview = t(decision === 'deny' ? 'operationDenied' : decision === 'always-allow' ? 'operationAllowedAlways' : 'operationAllowed') // 预览反馈结果
  UI.notify(t(decision === 'deny' ? 'toolDenied' : 'toolAllowed'))     // 全局短反馈确认点击生效
  return true                                                            // 通知工具条退出审批状态
}


// --- 添加输入附件 ---
function attach(sessionID, files) {
  const session = store.sessions[sessionID]                              // 读取附件所属会话
  if (!session) return false                                             // 无会话不能保存附件草稿
  for (const file of files) {
    if (session.files.some((item) => item.name === file.name && item.size === file.size)) continue // 避免重复选择同一文件
    session.files.push({ id: `file-${crypto.randomUUID()}`, name: file.name, size: file.size, type: file.type || 'application/octet-stream' }) // 只保存页面需要的元数据
  }
  return true                                                            // 输入框即时展示附件
}


// --- 移除输入附件 ---
function removeFile(sessionID, fileID) {
  const session = store.sessions[sessionID]                              // 读取附件草稿
  if (!session) return false                                             // 无会话保持页面不变
  const index = session.files.findIndex((file) => file.id === fileID)    // 找到对应附件
  if (index < 0) return false                                            // 已移除附件无需重复动作
  session.files.splice(index, 1)                                         // 从输入区移除附件
  return true                                                            // 反馈动作完成
}


// --- 回退到工具步骤 ---
function rollback(sessionID, checkpoint) {
  const session = store.sessions[sessionID]                              // 读取目标会话
  if (!session || session.status === 'running') return false             // 运行中不能竞争修改历史
  const index = session.messages.findIndex((message) => message.tools?.some((tool) => tool.checkpoint === checkpoint)) // 定位工具所属助手消息
  if (index < 0) return false                                             // 不存在步骤保持历史

  // TODO(API): POST /session/history，action=rollback-checkpoint。
  session.rollback = { type: 'checkpoint', checkpoint, messages: session.messages.splice(index + 1), preview: t('toolStep', { step: checkpoint }) } // 暂存后续消息
  syncSummary(session)                                                    // 列表计数立即更新
  return true                                                             // 显示回退预览条
}


// --- 回退用户消息并填回输入框 ---
function rollbackMessage(sessionID, messageID) {
  const session = store.sessions[sessionID]                              // 读取目标会话
  if (!session || session.status === 'running') return false             // 运行中不能编辑旧分支
  const index = session.messages.findIndex((message) => message.id === messageID && message.role === 'user') // 定位用户消息
  if (index < 0) return false                                             // 目标不存在保持历史

  // TODO(API): POST /session/history，action=rollback-message。
  const target = session.messages[index]                                  // 保存原文供输入框恢复
  session.rollback = { type: 'message', messageID, messages: session.messages.splice(index), preview: target.content } // 暂存目标及后续历史
  session.draft = target.content                                          // 把原用户消息填回输入框
  syncSummary(session)                                                     // 列表计数立即更新
  return true                                                              // 显示撤销回退动作
}


// --- 撤销最近回退 ---
function undoRollback(sessionID) {
  const session = store.sessions[sessionID]                               // 读取回退状态
  if (!session?.rollback) return false                                    // 没有暂存内容无需恢复

  // TODO(API): POST /session/history，action=undo。
  session.messages.push(...session.rollback.messages)                     // 按原顺序恢复隐藏历史
  session.rollback = null                                                  // 清除一次性回退状态
  session.draft = ''                                                       // 撤销用户消息回退时清除输入原文
  syncSummary(session)                                                      // 列表计数恢复
  return true                                                               // 反馈恢复完成
}


// --- 同步 Session 摘要 ---
function syncSummary(session) {
  const found = Session.locate(session.id)                                 // 查找工作区内摘要
  if (!found) return                                                       // 草稿异常时不产生游离摘要
  Object.assign(found.summary, { title: session.title, model: session.model, messageCount: session.messages.length, updatedAt: session.updatedAt || Date.now() }) // 同步列表需要的最小字段
}


export const Chat = { current, submitInput, send, stop, decide, attach, removeFile, rollback, rollbackMessage, undoRollback } // 暴露全部对话动作
