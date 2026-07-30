/*
对话指令集：启动真实模型 Agent 循环、执行工具权限、处理批准拒绝和用户中断。
入口只把 HTTP 请求交给 startLoop；本文件按“读取配置 → 调用模型 → 修改会话 → SSE 反馈”推进流程。
调用示例：Chat.startLoop({ sessionID, message, request })、Chat.approve(sessionID, toolCallID)。
*/
import { generateText, streamText, tool } from 'ai'                   // 引入真实模型生成、流式输出和工具协议
import { z } from 'zod'                                               // 引入工具参数 schema 转换能力
import { Config } from './config.js'                                  // 引入即时配置与模型创建动作
import { Session } from './session.js'                                // 引入会话读取、修改和持久化动作
import { toolStore } from '../store/tools.js'                        // 引入当前工具注册表
import { compressMessages } from '../utils/compress.js'              // 引入只作用于模型请求的上下文压缩
import { retry } from '../utils/retry.js'                             // 引入模型失败后的无限退避重试

const runningLoops = new Map()                                        // sessionID 到 AbortController，统一管理运行中循环
const approvals = new Map()                                           // toolCallID 到批准 Promise，承载 ask 权限的暂停恢复
const sseEncoder = new TextEncoder()                                   // 将 SSE 文本转换为真实 HTTP socket 接受的 UTF-8 字节


// --- 将项目参数定义转换为 Zod ---
function createSchema(parameters = {}) {
  const fields = {}                                                   // 为 AI SDK 工具协议准备字段映射
  for (const [name, definition] of Object.entries(parameters)) {
    let field = definition.type === 'number' ? z.number() : definition.type === 'boolean' ? z.boolean() : z.string() // 支持项目文档规定的基础类型
    if (definition.enum) field = z.enum(definition.enum)               // 枚举字段必须限制到配置允许的值
    fields[name] = definition.required ? field : field.optional().default(definition.default) // 非必填字段使用默认值
  }
  return z.object(fields)                                             // 返回 AI SDK 可以校验模型参数的对象 schema
}


// --- 判断工具权限 ---
function getPermission(name, input) {
  const rule = Config.get().permissions?.[name]                       // 读取当前工具的最新权限规则
  if (typeof rule === 'string') return rule                              // 简单字符串规则直接生效
  if (rule && typeof rule === 'object') {                              // 对第一个参数应用从上到下的通配规则
    const target = String(Object.values(input ?? {})[0] ?? '')           // README 规定用第一个参数作为匹配目标
    let permission = 'ask'                                               // 没有匹配项时默认需要用户确认
    for (const [pattern, value] of Object.entries(rule)) {
      const expression = new RegExp(`^${pattern.replace(/[.+^${}()|[\\]\\]/g, '\\$&').replace(/\\*/g, '.*').replace(/\\?/g, '.')}$`) // 将 * 与 ? 转为全字符串匹配
      if (expression.test(target)) permission = value                     // 后匹配规则覆盖先匹配规则
    }
    return permission
  }
  return 'ask'                                                           // 未配置工具默认 ask，保护真实副作用
}


// --- 等待用户批准工具 ---
function waitForApproval(sessionID, toolCallID, toolName, input, emit) {
  return new Promise((resolve) => {                                    // 将循环暂停点暴露给 approve/reject API
    approvals.set(toolCallID, { sessionID, resolve })                   // 保存恢复函数直到用户作出决定
    emit('tool-approval-request', { id: toolCallID, name: toolName, args: input }) // 先反馈确认所需的完整信息
  })
}


// --- 执行一个受权限保护的工具 ---
async function executeTool(sessionID, toolCallID, name, input, emit) {
  const definition = toolStore.items.get(name)                          // 从注册表读取模型请求时使用的同一工具
  if (!definition) return { result: `工具不存在: ${name}` }              // 工具被热删除时返回业务错误而不中断循环

  const permission = getPermission(name, input)                          // 每次执行前重新读取权限，支持即时更新
  if (permission === 'deny') return { result: '该工具已被用户禁止使用。请尝试其他方式完成任务。' } // deny 不产生副作用
  if (permission === 'ask') {                                           // ask 必须等待 HTTP approve 或 reject
    const approved = await waitForApproval(sessionID, toolCallID, name, input, emit) // 暂停直到用户明确选择
    if (!approved) return { result: '用户拒绝了该工具的执行。', stop: true } // 现场拒绝反馈给模型并停止当前 Agent 循环
  }

  try {
    return await definition.execute(input)                               // 执行真实工具并把结果传回模型
  } catch (error) {
    return { result: `工具执行失败: ${error.message}` }                   // 工具业务错误变成模型可恢复的正常反馈
  }
}


// --- 完成一轮真实模型流调用 ---
async function runModelRound({ model, systemPrompt, modelMessages, tools, abortSignal, streamWriter }) {
  const result = streamText({ model, system: systemPrompt, messages: modelMessages, tools, abortSignal }) // 发起真实流式模型请求
  const toolCalls = []                                                 // 收集模型声明的工具调用供展示持久化
  const toolResults = []                                               // 收集真实工具执行结果供存档与停止判断
  let text = ''                                                        // 累加本轮助手文本
  let reasoning = ''                                                   // 累加本轮模型推理文本
  for await (const part of result.fullStream) {                        // 流消费错误也交给外层 retry 处理
    writeEvent(streamWriter, part.type, part)                          // 透传每个 AI SDK 流事件
    if (part.type === 'text-delta') text += part.text                  // 合并文本增量供会话展示
    if (part.type === 'reasoning-delta') reasoning += part.text        // 合并 reasoning 增量供折叠展示
    if (part.type === 'tool-call') toolCalls.push(part)                // 保存本轮工具声明
    if (part.type === 'tool-result') toolResults.push(part)            // 保存本轮工具结果
  }
  const response = await result.response                               // 取得 AI SDK 为下一轮构造的标准消息
  return { response, toolCalls, toolResults, text, reasoning }         // 将一轮完整数据反馈给循环
}


// --- 创建 AI SDK 工具集合 ---
function createTools(sessionID, emit) {
  return Object.fromEntries([...toolStore.items].map(([name, definition]) => [name, tool({ // 每个注册项转换为 AI SDK 工具
    description: definition.description,                                // 透传工具用途说明给真实模型
    inputSchema: createSchema(definition.parameters),                    // 使用项目参数定义约束模型输入
    execute: (input, { toolCallId }) => executeTool(sessionID, toolCallId, name, input, emit), // 将执行交回统一权限指令
  })]))
}


// --- 向 SSE 客户端写入事件 ---
function writeEvent(streamWriter, event, data) {
  const payload = JSON.stringify(data, (_, value) => typeof value === 'bigint' ? Number(value) : value) // 保证 token 数等值可序列化
  const frame = `event: ${event}\ndata: ${payload}\n\n`               // 组装一个完整标准 SSE 事件帧
  streamWriter.enqueue(sseEncoder.encode(frame))                        // 网络 Response 必须写入字节，避免真实 socket 被 Bun 重置
}


// --- 启动 Agent 循环并返回 SSE 流 ---
function startLoop({ sessionID, message, request, initialEvents = [] }) {
  const stream = new ReadableStream({                                  // 使用 Web Stream 让 Elysia 直接返回流式响应
    async start(streamWriter) {
      const stopSignal = new AbortController()                          // 为 stop API 和客户端断开准备中断信号
      runningLoops.set(sessionID, stopSignal)                            // 注册当前会话的运行中循环
      request.signal.addEventListener('abort', () => stopSignal.abort(), { once: true }) // HTTP 客户端断开时停止真实请求
      const emit = (event, data) => writeEvent(streamWriter, event, data) // 将自定义事件统一写入当前响应
      initialEvents.forEach(({ event, data }) => emit(event, data))      // 先反馈入口创建的会话，再输出模型流
      const session = Session.getMutable(sessionID)                      // 读取入口已经创建或确认的目标会话
      session.rollbackCache = null                                      // 新消息确认回滚正式生效，清空撤销缓存
      session.messages.push({ role: 'user', content: message })         // 将用户触发写入完整展示历史
      session.modelMessages ??= []                                      // 初始化仅供模型调用的标准消息历史
      session.modelMessages.push({ role: 'user', content: message })    // 保持 AI SDK 上下文与展示历史同步
      await Session.persist(session)                                    // 用户消息先落盘，崩溃后仍可恢复

      if (session.messages.length === 1) createTitle(sessionID, message, emit).catch(() => {}) // 首条消息异步生成标题，不阻塞主循环
      let textOnlyCount = 0                                             // 连续无工具响应计数，用于兼容模型先说话行为
      let shouldStop = false                                            // 记录工具 stop 或用户中断导致的终止状态

      try {
        while (!shouldStop && !stopSignal.signal.aborted) {              // 只有明确 stop、中断或纯文本上限才结束
          const model = Config.getActiveModel()                         // 每一轮重新读取配置，模型切换立即生效
          const modelMessages = compressMessages(session.modelMessages, Config.getContextLimit()) // 压缩仅作用于本轮请求
          const tools = createTools(sessionID, emit)                     // 使用当前注册表构建最新工具集合
          const round = await retry(() => runModelRound({ model, systemPrompt: Config.get().systemPrompt, modelMessages, tools, abortSignal: stopSignal.signal, streamWriter }), ({ error, attempt, nextRetryIn }) => emit('error-retry', { message: String(error), attempt, nextRetryIn }), stopSignal.signal) // 请求创建和流消费都执行无限退避重试
          const previousSteps = session.messages.filter((item) => item.role === 'tool').map((item) => item.step ?? 0) // 读取已持久化的全部工具步骤
          const nextStep = Math.max(0, ...previousSteps) + 1                 // 本轮并行工具共享同一个新步骤号
          shouldStop = round.toolResults.some((part) => part.output?.stop === true) // 任一工具明确 stop 时结束整个循环
          session.modelMessages.push(...round.response.messages)             // 将模型消息加入仅供下一轮使用的上下文
          session.messages.push({ role: 'assistant', content: round.text, reasoning: round.reasoning, toolCalls: round.toolCalls }) // 保存前端可读的助手消息
          round.toolResults.forEach((part) => session.messages.push({ role: 'tool', toolCallId: part.toolCallId, name: part.toolName, result: part.output, step: nextStep })) // 并行结果使用同一 checkpoint
          await Session.persist(session)                                     // 每轮模型与工具反馈完成后立即持久化
          if (round.toolResults.length) textOnlyCount = 0                     // 工具执行成功后重新允许纯文本重试
          else textOnlyCount += 1                                             // 纯文本响应进入兼容性重试计数
          if (textOnlyCount === 2) session.modelMessages.push({ role: 'user', content: '如果任务尚未完成，请使用工具执行；如果已经完成，请调用 task_done 结束。' }) // 第二次纯文本时注入明确提醒
          if (textOnlyCount >= 3) shouldStop = true                           // 连续三次纯文本后按设计停止异常循环
        }
        writeEvent(streamWriter, 'finish', { ok: true, sessionID })            // 反馈当前 SSE 流已完成
      } catch (error) {
        writeEvent(streamWriter, 'error', { message: String(error) })           // 将不可恢复错误反馈给真实客户端
      } finally {
        runningLoops.delete(sessionID)                                         // 清理运行中状态，允许下一次发送
        streamWriter.close()                                                    // 关闭 SSE 响应流
      }
    },
    cancel() { runningLoops.get(sessionID)?.abort() },                         // 客户端断开时停止真实模型请求
  })
  return stream
}


// --- 异步生成会话标题 ---
async function createTitle(sessionID, message, emit) {
  const model = Config.getActiveModel()                                         // 标题也使用配置中的真实模型
  const result = await generateText({ model, system: '将用户消息概括为不超过10个字的标题，只输出标题。', prompt: message }) // 非阻塞调用真实模型生成标题
  const session = Session.getMutable(sessionID)                                  // 读取仍存在的目标会话
  if (!session || session.title) return                                         // 会话被删除或已有标题时不覆盖用户数据
  session.title = result.text.trim().slice(0, 10)                                // 限制标题长度，保持列表布局稳定
  await Session.persist(session)                                                 // 标题生成后真实写盘
  emit('session-title', { title: session.title })                                // 通过 SSE 通知前端更新摘要
}


// --- 停止运行中的循环 ---
function stop(sessionID) {
  const stopSignal = runningLoops.get(sessionID)                                 // 查找目标会话的中断信号
  if (!stopSignal) return { ok: false, error: 'session is not running' }          // 没有运行循环时反馈明确状态
  stopSignal.abort()                                                             // 中断模型请求、工具等待和后续循环
  for (const [toolCallID, pending] of approvals) {                                // 同时释放该会话可能等待的权限 Promise
    if (pending.sessionID !== sessionID) continue                                // 其他会话的审批不受本次停止影响
    approvals.delete(toolCallID)                                                  // 清除停止会话的等待项
    pending.resolve(false)                                                        // 以拒绝结果恢复并结束挂起工具
  }
  return { ok: true }                                                             // 反馈停止信号已发出
}


// --- 批准等待中的工具 ---
function approve(sessionID, toolCallID) {
  const pending = approvals.get(toolCallID)                                      // 查找等待用户决定的工具调用
  if (!pending || pending.sessionID !== sessionID) return { ok: false, error: 'tool call is not waiting for approval' } // 只允许所属会话批准调用
  approvals.delete(toolCallID)                                                    // 消费一次性恢复函数
  pending.resolve(true)                                                           // 恢复工具执行并允许真实副作用发生
  return { ok: true }                                                             // 反馈批准已经生效
}


// --- 拒绝等待中的工具 ---
function reject(sessionID, toolCallID) {
  const pending = approvals.get(toolCallID)                                      // 查找等待用户决定的工具调用
  if (!pending || pending.sessionID !== sessionID) return { ok: false, error: 'tool call is not waiting for approval' } // 只允许所属会话拒绝调用
  approvals.delete(toolCallID)                                                    // 消费一次性恢复函数
  pending.resolve(false)                                                          // 恢复循环并让模型收到拒绝结果
  return { ok: true }                                                             // 反馈拒绝已经生效
}


export const Chat = { startLoop, stop, approve, reject }                         // 导出对话循环和交互控制动作
