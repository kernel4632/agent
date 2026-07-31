/*
对话指令集：启动真实模型 Agent 循环、执行工具权限、处理批准拒绝和用户中断。
入口只把 HTTP 请求交给 startLoop；本文件按“读取配置 → 调用模型 → 修改会话 → SSE 反馈”推进流程。
调用示例：Chat.startLoop({ sessionID, message, request })、Chat.stop(runID)。
*/
import { generateText, jsonSchema, streamText, tool } from 'ai'       // 引入真实模型生成、JSON Schema 和工具协议
import { z } from 'zod'                                               // 引入工具参数 schema 转换能力
import { Config } from './config.js'                                  // 引入即时配置与模型创建动作
import { Agent } from './agent.js'                                    // 引入模型选择和提示词快照
import { Approval } from './approval.js'                              // 引入工具审批等待指令
import { Run } from './run.js'                                        // 引入每次执行的生命周期状态
import { Session } from './session.js'                                // 引入会话读取、修改和持久化动作
import { Skill } from './skill.js'                                    // 引入渐进披露技能目录
import { store } from '../store.js'                                   // 引入服务端唯一状态根

const toolStore = store.tools                                            // 当前指令使用工具领域状态
import { compressMessages } from '../utils/compress.js'              // 引入只作用于模型请求的上下文压缩
import { retry } from '../utils/retry.js'                             // 引入模型失败后的无限退避重试

const runningLoops = new Map()                                        // sessionID 到根 Run ID，保证同一会话只有一个主循环
const sseEncoder = new TextEncoder()                                   // 将 SSE 文本转换为真实 HTTP socket 接受的 UTF-8 字节
const taskInstruction = '任务包含三个及以上明确步骤时，先调用 task_list_update 建立清单；每完成或开始一项时再次提交完整清单。简单问答不要创建任务清单。' // 让任务工具成为复杂工作流而非装饰


// --- 读取单次 Run 的总执行预算 ---
function getRunTimeoutMs() {
  const configured = Number(Config.get().runTimeoutMs)                       // 从当前全局配置读取运行边界
  return Number.isFinite(configured) && configured > 0 ? configured : 300000 // 无效配置回退到五分钟
}


// --- 将项目参数定义转换为 Zod ---
function createSchema(parameters = {}) {
  const fields = {}                                                   // 为 AI SDK 工具协议准备字段映射
  for (const [name, definition] of Object.entries(parameters)) {
    const field = createSchemaField(definition)                        // 递归支持基础值、数组和对象
    fields[name] = definition.required ? field : definition.default !== undefined ? field.optional().default(definition.default) : field.optional() // 未声明默认值时只使用 optional，避免 Zod 4 序列化 undefined
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


// --- 执行一个受权限保护的工具 ---
async function executeTool(runID, sessionID, toolCallID, name, input, emit, abortSignal) {
  const definition = toolStore.items.get(name)                          // 从注册表读取模型请求时使用的同一工具
  if (!definition) return { result: `工具不存在: ${name}` }              // 工具被热删除时返回业务错误而不中断循环

  const matched = getPermission(name, input)                             // 每次执行前重新读取权限和命中范围
  if (matched.permission === 'deny') return { result: '该工具已被用户禁止使用。请尝试其他方式完成任务。' } // deny 不产生副作用
  if (matched.permission === 'ask') {                                    // ask 必须等待三选一审批
    const decision = await Approval.wait({ runID, sessionID, toolCallID, toolName: name, input, matched, emit, abortSignal }) // 暂停直到用户决定或 Run 中断
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
      spawnAgent: (prompt, agentID) => runChild(runID, sessionID, prompt, agentID, emit), // 子 Agent 共享环境但使用独立 Run 和模型上下文
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
    if (part.type !== 'finish' && streamWriter) writeEvent(streamWriter, part.type, part) // 子 Run 不占用父级 SSE，根 Run 才反馈增量
    if (part.type === 'text-delta') text += part.text                  // 合并文本增量供会话展示
    if (part.type === 'reasoning-delta') reasoning += part.text        // 合并 reasoning 增量供折叠展示
    if (part.type === 'tool-call') toolCalls.push(part)                // 保存本轮工具声明
    if (part.type === 'tool-result') toolResults.push(part)            // 保存本轮工具结果
  }
  if (!text.trim() && !reasoning.trim() && toolCalls.length === 0) {
    const error = new Error('model returned an empty response')         // 空成功无法推进任务，应按上游临时故障处理
    error.statusCode = 503                                              // 复用有限重试预算，禁止额外无限模型轮次
    throw error
  }
  const response = await result.response                               // 取得 AI SDK 为下一轮构造的标准消息
  return { response, toolCalls, toolResults, text, reasoning }         // 将一轮完整数据反馈给循环
}


// --- 创建 AI SDK 工具集合 ---
function createTools(runID, sessionID, emit, abortSignal) {
  return Object.fromEntries([...toolStore.items].map(([name, definition]) => [name, tool({ // 每个注册项转换为 AI SDK 工具
    description: definition.description,                                // 透传工具用途说明给真实模型
    inputSchema: definition.inputSchema ? jsonSchema(definition.inputSchema) : createSchema(definition.parameters), // MCP 原生 JSON Schema 与本地简化 schema 共用执行链
     execute: (input, { toolCallId }) => executeTool(runID, sessionID, toolCallId, name, input, emit, abortSignal), // 将执行交回统一权限指令
  })]))
}


// --- 执行一个子 Agent 任务 ---
async function runChild(parentRunID, sessionID, prompt, agentID, emit) {
  const child = Run.create({ sessionID, agentID, parentRunID, input: prompt }) // 子 Agent 只接收显式任务文本
  const agent = Agent.resolve(child.agentID)                                // 固定子 Run 的模型选择
  Run.markRunning(child.id)                                                  // 进入独立运行态
  emit('child-run-created', { runID: child.id, parentRunID, agentID: child.agentID, input: prompt }) // 父流实时展示子 Run
  const messages = [{ role: 'user', content: prompt }]                       // 子 Agent 不直接读取父模型历史
  let text = ''                                                              // 收集子 Agent 最终可交付摘要
  let rounds = 0                                                             // 保护子 Agent 不陷入无限模型轮次
  let textOnlyCount = 0                                                      // 记录没有工具调用的连续模型轮次
  const childEmit = (event, data) => emit(event, { ...data, runID: child.id, parentRunID }) // 子事件沿父 SSE 反馈但保留子 Run 归属
  const childDeadline = setTimeout(() => child.abortController.abort('run timeout exceeded'), getRunTimeoutMs()) // 子任务总预算覆盖全部模型轮次

  try {
    while (!child.abortController.signal.aborted && rounds < 8) {
      rounds += 1                                                            // 每轮都受统一深度和次数限制
      const round = await retry((attemptSignal) => runModelRound({
        model: Config.createModel(agent.provider, agent.model),
        systemPrompt: `${agent.systemPrompt}\n\n${taskInstruction}`,
        modelMessages: compressMessages(messages, Config.getContextLimitFor(agent.provider, agent.model)),
        tools: createTools(child.id, sessionID, childEmit, child.abortController.signal),
        providerOptions: Config.getProviderOptionsFor(agent.provider, `${sessionID}:${child.id}`),
        generationOptions: Config.getGenerationOptionsFor(agent.provider, agent.model),
        abortSignal: attemptSignal,
        streamWriter: null,
      }), () => {}, child.abortController.signal)                                 // 子 Run 重用模型重试和取消规则
      messages.push(...round.response.messages)                                // 只在子 Run 私有上下文中追加模型消息
      text += round.text                                                        // 保留子 Agent 的文本产出
      if (round.toolResults.some((part) => part.output?.stop === true)) break    // 明确完成工具结束子任务
      if (round.toolResults.length) textOnlyCount = 0                            // 工具调用后重新允许模型继续说明
      else textOnlyCount += 1                                                    // 纯文本不能立即伪装成已完成任务
      if (textOnlyCount >= 3) break                                              // 连续三轮仍无工具时按模型能力边界交付文字
      if (textOnlyCount) messages.push({ role: 'user', content: '如果任务已经完成，请调用 task_done；如果尚未完成，请继续使用工具执行。' }) // 明确推动子 Agent 完成工具协议
    }
    const result = { summary: text.trim(), rounds }                              // 父 Agent 只接收不可变摘要和轮次
    Run.complete(child.id, result)                                                // 记录子 Run 完成事实
    emit('child-run-finished', { runID: child.id, parentRunID, status: 'completed', result }) // 父流收到子 Run 结果摘要
    return { result: result.summary || '子 Agent 已完成但没有文本摘要。', childRunID: child.id } // 工具结果显式携带子 Run ID
  } catch (error) {
    Run.fail(child.id, error)                                                      // 子 Run 故障不污染父 Run 状态
    emit('child-run-finished', { runID: child.id, parentRunID, status: 'failed', error: error.message }) // 父流收到子 Run 失败反馈
    return { result: `子 Agent 执行失败: ${error.message}`, childRunID: child.id, failed: true } // 将失败作为父模型可理解的工具结果
  } finally {
    clearTimeout(childDeadline)                                                   // 子任务任意终态都释放总预算定时器
  }
}


// --- 向 SSE 客户端写入事件 ---
function writeEvent(streamWriter, event, data) {
  const payload = JSON.stringify(data, (_, value) => typeof value === 'bigint' ? Number(value) : value) // 保证 token 数等值可序列化
  const frame = `event: ${event}\ndata: ${payload}\n\n`               // 组装一个完整标准 SSE 事件帧
  streamWriter.enqueue(sseEncoder.encode(frame))                        // 网络 Response 必须写入字节，避免真实 socket 被 Bun 重置
}


// --- 启动 Agent 循环并返回 SSE 流 ---
function startLoop({ runID, sessionID, agentID, message, messageID, request, initialEvents = [] }) {
  if (runningLoops.has(sessionID)) {                                    // 同一会话只能存在一个修改历史的循环
    const error = new Error('session is running')                       // 路由可将竞争反馈为 HTTP 409
    error.code = 'SESSION_RUNNING'                                      // 稳定错误码避免依赖文本匹配
    throw error
  }
  const run = runID ? Run.get(runID) : Run.create({ sessionID, agentID, input: message }) // 路由创建 Run，旧调用由指令补建
  if (!run || run.sessionID !== sessionID) throw new Error('run does not belong to session') // 执行必须绑定准确会话
  const agent = Agent.resolve(run.agentID)                              // 固定本次执行的模型选择和提示词
  Run.markRunning(run.id)                                                // 先进入运行态，再接受客户端断开
  const stopSignal = run.abortController                                // 每个 Run 拥有独立取消信号
  const runDeadline = setTimeout(() => stopSignal.abort('run timeout exceeded'), getRunTimeoutMs()) // 根 Run 总预算覆盖重试和全部模型轮次
  runningLoops.set(sessionID, run.id)                                    // 后续发送立即能观察到主 Run
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
          const model = Config.createModel(agent.provider, agent.model)   // 每轮使用 Run 固定的模型选择
          const modelMessages = compressMessages(session.modelMessages, Config.getContextLimitFor(agent.provider, agent.model)) // 压缩仅作用于本轮请求
          const tools = createTools(run.id, sessionID, emit, stopSignal.signal) // 工具注册表全局共享，审批按 Run 隔离
          const providerOptions = Config.getProviderOptionsFor(agent.provider, `${sessionID}:${run.id}`) // 当前 Run 使用稳定缓存键
          const generationOptions = Config.getGenerationOptionsFor(agent.provider, agent.model) // 使用 Agent 对应模型设置
          const skillCatalog = Skill.catalogPrompt()                             // 每轮读取最新 Skill 元数据目录
          const systemPrompt = `${agent.systemPrompt}\n\n${taskInstruction}${skillCatalog ? `\n\n${skillCatalog}` : ''}` // 提示词来自 Run 快照，Skill 仍来自全局目录
          const round = await retry((attemptSignal) => runModelRound({ model, systemPrompt, modelMessages, tools, providerOptions, generationOptions, abortSignal: attemptSignal, streamWriter }), ({ error, attempt, nextRetryIn }) => emit('error-retry', { message: String(error), attempt, nextRetryIn }), stopSignal.signal) // 可恢复请求受次数、总时长和用户停止三重约束
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
        if (stopSignal.signal.aborted) {
          Run.cancel(run.id, String(stopSignal.signal.reason || 'cancelled')) // 循环因用户停止退出时保持取消语义
          writeEvent(streamWriter, 'finish', { ok: false, cancelled: true, sessionID, runID: run.id, agentID: run.agentID }) // 不把主动停止伪装成成功
        } else {
          Run.complete(run.id, { sessionID })                             // 记录本次 Run 完成事实
          writeEvent(streamWriter, 'finish', { ok: true, sessionID, runID: run.id, agentID: run.agentID }) // 反馈完整执行归属
        }
      } catch (error) {
        if (stopSignal.signal.aborted) Run.cancel(run.id, String(stopSignal.signal.reason || 'cancelled')) // 主动停止进入取消态
        else Run.fail(run.id, error)                                           // 未知故障进入失败态
        if (!stopSignal.signal.aborted && error?.name !== 'AbortError') writeEvent(streamWriter, 'error', { message: String(error) }) // 主动停止不伪装成错误
      } finally {
        clearTimeout(runDeadline)                                               // 成功、失败和中断都释放 Run 总预算
        if (runningLoops.get(sessionID) === run.id) runningLoops.delete(sessionID) // 只清理当前主 Run，不能覆盖后来注册的状态
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
function stop(targetID) {
  const runID = Run.get(targetID) ? targetID : runningLoops.get(targetID)          // 兼容按 Run ID 和旧 Session ID 停止
  if (!runID) return { ok: false, error: 'session is not running' }                // 没有运行循环时反馈明确状态
  Run.cancel(runID, 'stopped by user')                                             // 中断目标 Run 并向下传播到子 Run
  return { ok: true }                                                             // 反馈停止信号已发出
}


// --- 判断会话是否正在运行 ---
function isRunning(sessionID) {
  return runningLoops.has(sessionID)                                             // 回退和删除可据此避免与主流写入竞争
}


export const Chat = { startLoop, stop, isRunning }                                 // 导出对话循环和停止状态动作
