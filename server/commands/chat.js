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
const approvals = new Map()                                           // 会话与 toolCallID 组合键到审批 Promise，避免跨会话冲突
const sseEncoder = new TextEncoder()                                   // 将 SSE 文本转换为真实 HTTP socket 接受的 UTF-8 字节
const taskInstruction = '任务包含三个及以上明确步骤时，先调用 task_list_update 建立清单；每完成或开始一项时再次提交完整清单。简单问答不要创建任务清单。' // 让任务工具成为复杂工作流而非装饰


// --- 将项目参数定义转换为 Zod ---
function createSchema(parameters = {}) {
  const fields = {}                                                   // 为 AI SDK 工具协议准备字段映射
  for (const [name, definition] of Object.entries(parameters)) {
    const field = createSchemaField(definition)                        // 递归支持基础值、数组和对象
    fields[name] = definition.required ? field : field.optional().default(definition.default) // 非必填字段使用默认值
  }
  return z.object(fields)                                             // 返回 AI SDK 可以校验模型参数的对象 schema
}


// --- 转换一个工具参数字段 ---
function createSchemaField(definition = {}) {
  if (definition.enum) return z.enum(definition.enum)                  // 枚举字段限制到配置允许的字符串值
  if (definition.type === 'number') return z.number()                  // 数值字段拒绝模型生成的字符串
  if (definition.type === 'boolean') return z.boolean()                // 布尔字段拒绝模糊真值
  if (definition.type === 'array') return z.array(createSchemaField(definition.items)) // 数组递归验证每个元素
  if (definition.type === 'object') return createSchema(definition.properties) // 对象递归验证全部属性
  return z.string()                                                    // 未声明类型时保持原有字符串默认行为
}


// --- 判断工具权限 ---
function getPermission(name, input) {
  const rule = Config.get().permissions?.[name]                       // 读取当前工具的最新权限规则
  if (typeof rule === 'string') return { permission: rule, rule, scope: 'tool' } // 简单字符串规则作用于整个工具
  if (rule && typeof rule === 'object') {                              // 对第一个参数应用从上到下的通配规则
    const target = String(Object.values(input ?? {})[0] ?? '')           // README 规定用第一个参数作为匹配目标
    let permission = 'ask'                                               // 没有匹配项时默认需要用户确认
    let matchedRule = null                                                // 记录最终命中的通配规则供审批界面展示
    for (const [pattern, value] of Object.entries(rule)) {
      const expression = new RegExp(`^${pattern.replace(/[.+^${}()|[\\]\\]/g, '\\$&').replace(/\\*/g, '.*').replace(/\\?/g, '.')}$`) // 将 * 与 ? 转为全字符串匹配
      if (expression.test(target)) { permission = value; matchedRule = pattern } // 后匹配规则覆盖先匹配规则
    }
    return { permission, rule: matchedRule, scope: 'argument', target }   // 返回权限及实际匹配范围
  }
  return { permission: 'ask', rule: null, scope: 'default' }             // 未配置工具默认 ask，保护真实副作用
}


// --- 等待用户批准工具 ---
function waitForApproval(sessionID, toolCallID, toolName, input, matched, emit, abortSignal) {
  return new Promise((resolve) => {                                    // 将循环暂停点暴露给 approve/reject API
    const approvalKey = createApprovalKey(sessionID, toolCallID)        // 同一调用 ID 在不同会话中保持隔离
    const finish = (decision) => {                                      // 审批或中断都通过同一清理出口恢复循环
      approvals.delete(approvalKey)                                     // 移除一次性等待项
      abortSignal.removeEventListener('abort', abortWait)                // 审批完成后释放中断监听
      resolve(decision)                                                  // 将三选一决定反馈给工具执行
    }
    const abortWait = () => finish('deny')                               // 停止会话时按拒绝恢复，不留下挂起 Promise
    approvals.set(approvalKey, { sessionID, toolCallID, toolName, finish, deciding: false }) // 保存审批需要的完整归属
    abortSignal.addEventListener('abort', abortWait, { once: true })      // 工具等待也响应客户端断开和 stop
    if (abortSignal.aborted) return abortWait()                           // 已中断请求不能进入永久等待
    emit('tool-approval-request', { id: toolCallID, name: toolName, args: input, matchedRule: matched.rule, scope: matched.scope, target: matched.target }) // 反馈确认信息和命中范围
  })
}


// --- 执行一个受权限保护的工具 ---
async function executeTool(sessionID, toolCallID, name, input, emit, abortSignal) {
  const definition = toolStore.items.get(name)                          // 从注册表读取模型请求时使用的同一工具
  if (!definition) return { result: `工具不存在: ${name}` }              // 工具被热删除时返回业务错误而不中断循环

  const matched = getPermission(name, input)                             // 每次执行前重新读取权限和命中范围
  if (matched.permission === 'deny') return { result: '该工具已被用户禁止使用。请尝试其他方式完成任务。' } // deny 不产生副作用
  if (matched.permission === 'ask') {                                    // ask 必须等待三选一审批
    const decision = await waitForApproval(sessionID, toolCallID, name, input, matched, emit, abortSignal) // 暂停直到用户决定或会话中断
    if (decision === 'deny') return { result: '用户拒绝了该工具的执行。', stop: true, denied: true } // 现场拒绝作为持久语义反馈并停止循环
  }

  try {
    return await definition.execute(input, {                             // 注入当前会话允许的指令能力
      sessionID,                                                         // 自定义工具可识别当前会话但不能直接修改 store
      async updateTasks(tasks) {
        const updated = await Session.updateTasks(sessionID, tasks)      // 任务工具通过 Session 指令完成验证和持久化
        if (!updated.ok) throw new Error(updated.error)                   // 验证错误进入统一工具失败反馈
        emit('task-list-updated', { tasks: updated.tasks, taskRevision: updated.taskRevision }) // 实时通知客户端最新任务清单
        return { result: '任务清单已更新。', tasks: updated.tasks, taskRevision: updated.taskRevision } // 将持久化结果反馈给模型
      },
    })
  } catch (error) {
    return { result: `工具执行失败: ${error.message}` }                   // 工具业务错误变成模型可恢复的正常反馈
  }
}


// --- 完成一轮真实模型流调用 ---
async function runModelRound({ model, systemPrompt, modelMessages, tools, providerOptions, generationOptions, abortSignal, streamWriter }) {
  const result = streamText({ model, system: systemPrompt, messages: modelMessages, tools, providerOptions, ...generationOptions, abortSignal }) // 应用显式生成设置和 Responses 缓存边界
  const toolCalls = []                                                 // 收集模型声明的工具调用供展示持久化
  const toolResults = []                                               // 收集真实工具执行结果供存档与停止判断
  let text = ''                                                        // 累加本轮助手文本
  let reasoning = ''                                                   // 累加本轮模型推理文本
  for await (const part of result.fullStream) {                        // 流消费错误也交给外层 retry 处理
    if (part.type !== 'finish') writeEvent(streamWriter, part.type, part) // 中间模型轮结束不冒充整个 Agent 完成
    if (part.type === 'text-delta') text += part.text                  // 合并文本增量供会话展示
    if (part.type === 'reasoning-delta') reasoning += part.text        // 合并 reasoning 增量供折叠展示
    if (part.type === 'tool-call') toolCalls.push(part)                // 保存本轮工具声明
    if (part.type === 'tool-result') toolResults.push(part)            // 保存本轮工具结果
  }
  const response = await result.response                               // 取得 AI SDK 为下一轮构造的标准消息
  return { response, toolCalls, toolResults, text, reasoning }         // 将一轮完整数据反馈给循环
}


// --- 创建 AI SDK 工具集合 ---
function createTools(sessionID, emit, abortSignal) {
  return Object.fromEntries([...toolStore.items].map(([name, definition]) => [name, tool({ // 每个注册项转换为 AI SDK 工具
    description: definition.description,                                // 透传工具用途说明给真实模型
    inputSchema: createSchema(definition.parameters),                    // 使用项目参数定义约束模型输入
    execute: (input, { toolCallId }) => executeTool(sessionID, toolCallId, name, input, emit, abortSignal), // 将执行交回统一权限指令
  })]))
}


// --- 向 SSE 客户端写入事件 ---
function writeEvent(streamWriter, event, data) {
  const payload = JSON.stringify(data, (_, value) => typeof value === 'bigint' ? Number(value) : value) // 保证 token 数等值可序列化
  const frame = `event: ${event}\ndata: ${payload}\n\n`               // 组装一个完整标准 SSE 事件帧
  streamWriter.enqueue(sseEncoder.encode(frame))                        // 网络 Response 必须写入字节，避免真实 socket 被 Bun 重置
}


// --- 启动 Agent 循环并返回 SSE 流 ---
function startLoop({ sessionID, message, messageID, request, initialEvents = [] }) {
  if (runningLoops.has(sessionID)) {                                    // 同一会话只能存在一个修改历史的循环
    const error = new Error('session is running')                       // 路由可将竞争反馈为 HTTP 409
    error.code = 'SESSION_RUNNING'                                      // 稳定错误码避免依赖文本匹配
    throw error
  }
  const stopSignal = new AbortController()                              // 在返回流前预留会话，关闭并发请求竞态
  runningLoops.set(sessionID, stopSignal)                               // 后续发送立即能观察到运行状态
  request.signal.addEventListener('abort', () => stopSignal.abort(), { once: true }) // HTTP 客户端断开时停止真实请求
  const stream = new ReadableStream({                                  // 使用 Web Stream 让 Elysia 直接返回流式响应
    async start(streamWriter) {
      const emit = (event, data) => writeEvent(streamWriter, event, data) // 将自定义事件统一写入当前响应
      try {
        initialEvents.forEach(({ event, data }) => emit(event, data))      // 先反馈入口创建的会话，再输出模型流
        const session = Session.getMutable(sessionID)                      // 读取入口已经创建或确认的目标会话
        Session.commitRollback(session)                                   // 新消息确认暂存回退正式生效
        session.modelMessages ??= []                                      // 初始化仅供模型调用的标准消息历史
        session.messages.push({ id: messageID ?? `msg_${crypto.randomUUID()}`, role: 'user', content: message }) // 将用户触发写入共享稳定 ID 的展示历史
        session.modelMessages.push({ role: 'user', content: message })    // 保持 AI SDK 上下文与展示历史同步
        await Session.persist(session)                                    // 用户消息先落盘，崩溃后仍可恢复

        if (session.messages.length === 1) createTitle(sessionID, message, emit).catch(() => {}) // 首条消息异步生成标题，不阻塞主循环
        let textOnlyCount = 0                                             // 连续无工具响应计数，用于兼容模型先说话行为
        let shouldStop = false                                            // 记录工具 stop 或用户中断导致的终止状态

        while (!shouldStop && !stopSignal.signal.aborted) {              // 只有明确 stop、中断或纯文本上限才结束
          const model = Config.getActiveModel()                         // 每一轮重新读取配置，模型切换立即生效
          const modelMessages = compressMessages(session.modelMessages, Config.getContextLimit()) // 压缩仅作用于本轮请求
          const tools = createTools(sessionID, emit, stopSignal.signal)  // 使用当前注册表并让审批等待响应中断
          const providerOptions = Config.getProviderOptions(sessionID)            // 同一会话每轮使用稳定缓存键
          const generationOptions = Config.getGenerationOptions()                 // 每轮读取当前模型输出上限和温度
          const systemPrompt = `${Config.get().systemPrompt}\n\n${taskInstruction}` // 在用户系统指令后追加工作台任务协议
          const round = await retry(() => runModelRound({ model, systemPrompt, modelMessages, tools, providerOptions, generationOptions, abortSignal: stopSignal.signal, streamWriter }), ({ error, attempt, nextRetryIn }) => emit('error-retry', { message: String(error), attempt, nextRetryIn }), stopSignal.signal) // 只对可恢复请求执行退避重试
          const previousSteps = session.messages.filter((item) => item.role === 'tool').map((item) => item.step ?? 0) // 读取已持久化的全部工具步骤
          const nextStep = Math.max(0, ...previousSteps) + 1                 // 本轮并行工具共享同一个新步骤号
          shouldStop = round.toolResults.some((part) => part.output?.stop === true) // 任一工具明确 stop 时结束整个循环
          session.modelMessages.push(...round.response.messages)             // 将模型消息加入仅供下一轮使用的上下文
          session.messages.push({ role: 'assistant', content: round.text, reasoning: round.reasoning, toolCalls: round.toolCalls }) // 保存前端可读的助手消息
          round.toolResults.forEach((part) => session.messages.push({ role: 'tool', toolCallId: part.toolCallId, name: part.toolName, input: round.toolCalls.find((call) => call.toolCallId === part.toolCallId)?.input, result: part.output, status: part.output?.denied ? 'rejected' : 'completed', step: nextStep })) // 并行结果保存真实拒绝或完成状态
          await Session.persist(session)                                     // 每轮模型与工具反馈完成后立即持久化
          if (round.toolResults.length) emit('checkpoint', { step: nextStep, toolCallIds: round.toolResults.map((part) => part.toolCallId) }) // 让实时工具立即获得回退步骤
          if (round.toolResults.length) textOnlyCount = 0                     // 工具执行成功后重新允许纯文本重试
          else textOnlyCount += 1                                             // 纯文本响应进入兼容性重试计数
          if (textOnlyCount === 2) session.modelMessages.push({ role: 'user', content: '如果任务尚未完成，请使用工具执行；如果已经完成，请调用 task_done 结束。' }) // 第二次纯文本时注入明确提醒
          if (textOnlyCount >= 3) shouldStop = true                           // 连续三次纯文本后按设计停止异常循环
        }
        writeEvent(streamWriter, 'finish', { ok: true, sessionID })            // 反馈当前 SSE 流已完成
      } catch (error) {
        if (!stopSignal.signal.aborted && error?.name !== 'AbortError') writeEvent(streamWriter, 'error', { message: String(error) }) // 主动停止不伪装成错误
      } finally {
        if (runningLoops.get(sessionID) === stopSignal) runningLoops.delete(sessionID) // 只清理当前循环，不能覆盖后来注册的状态
        streamWriter.close()                                                    // 关闭 SSE 响应流
      }
    },
    cancel() { stopSignal.abort() },                                            // 客户端断开只停止本响应所属循环
  })
  return stream
}


// --- 异步生成会话标题 ---
async function createTitle(sessionID, message, emit) {
  const model = Config.getActiveModel()                                         // 标题也使用配置中的真实模型
  const result = await generateText({ model, system: '将用户消息概括为不超过10个字的标题，只输出标题。', prompt: message, ...Config.getGenerationOptions(), providerOptions: Config.getProviderOptions(sessionID) }) // 非阻塞调用应用相同协议和无状态缓存设置
  const session = Session.getMutable(sessionID)                                  // 读取仍存在的目标会话
  if (!session || session.title || session.titleSource === 'user') return        // 会话被删除、已有标题或用户已接管时不覆盖
  session.title = result.text.trim().slice(0, 10)                                // 限制标题长度，保持列表布局稳定
  session.titleSource = 'generated'                                              // 明确记录该标题仍可由用户接管
  await Session.persist(session)                                                 // 标题生成后真实写盘
  emit('session-title', { title: session.title })                                // 通过 SSE 通知前端更新摘要
}


// --- 停止运行中的循环 ---
function stop(sessionID) {
  const stopSignal = runningLoops.get(sessionID)                                 // 查找目标会话的中断信号
  if (!stopSignal) return { ok: false, error: 'session is not running' }          // 没有运行循环时反馈明确状态
  stopSignal.abort()                                                             // 中断模型请求、工具等待和后续循环
  return { ok: true }                                                             // 反馈停止信号已发出
}


// --- 处理三选一工具审批 ---
async function approval(sessionID, toolCallID, decision) {
  const approvalKey = createApprovalKey(sessionID, toolCallID)                    // 使用完整归属定位等待项
  const pending = approvals.get(approvalKey)                                      // 查找当前会话等待中的工具调用
  if (!pending || pending.deciding) return { ok: false, status: 404, error: 'tool call is not waiting for approval' } // 一次审批只能消费一次

  pending.deciding = true                                                        // 持久化期间阻止第二个决定竞争
  try {
    if (decision === 'always-allow') await Config.allowTool(pending.toolName)     // 永久允许必须先写盘再恢复真实执行
    pending.finish(decision)                                                      // deny、allow-once 和已持久化的 always-allow 恢复工具
    return { ok: true, decision }                                                 // 反馈实际生效的审批选择
  } catch (error) {
    pending.deciding = false                                                      // 写盘失败后保留等待项供用户重试
    return { ok: false, status: 500, error: `failed to persist permission: ${error.message}` } // 工具尚未执行，明确反馈配置错误
  }
}


// --- 创建审批组合键 ---
function createApprovalKey(sessionID, toolCallID) {
  return `${sessionID}\u0000${toolCallID}`                                        // 不可见分隔符避免普通 ID 拼接碰撞
}


// --- 兼容原批准入口 ---
function approve(sessionID, toolCallID) {
  return approval(sessionID, toolCallID, 'allow-once')                         // 旧批准等同本次允许
}


// --- 兼容原拒绝入口 ---
function reject(sessionID, toolCallID) {
  return approval(sessionID, toolCallID, 'deny')                               // 旧拒绝等同现场拒绝
}


// --- 判断会话是否正在运行 ---
function isRunning(sessionID) {
  return runningLoops.has(sessionID)                                             // 回退和删除可据此避免与流写入竞争
}


export const Chat = { startLoop, stop, approval, approve, reject, isRunning }      // 导出对话循环和三选一交互控制动作
