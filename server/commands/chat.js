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
import { Skill } from './skills.js'                                   // 引入渐进披露技能目录
import { store } from '../store.js'                                   // 引入服务端唯一状态根
import { Event } from './event.js'                                    // 引入独立会话事件广播指令

const toolStore = store.tools                                            // 当前指令使用工具领域状态
import { compressMessages } from '../utils/compress.js'              // 引入只作用于模型请求的上下文压缩
import { retry } from '../utils/retry.js'                             // 引入模型失败后的无限退避重试

const runningLoops = new Map()                                        // sessionID 到根 Run ID，保证同一会话只有一个主循环
import { SSE } from '../utils/sse.js'                                  // 引入标准 SSE 字节编码工具
const taskInstruction = '任务包含三个及以上明确步骤时，先调用 task_list_update 建立清单；每完成或开始一项时再次提交完整清单。简单问答不要创建任务清单。一旦开始使用工具，就必须完成并检查所有要求，最后在单独一轮调用 task_done；task_done 不得与其他工具并行。' // 明确复杂任务规划和可靠完成协议
const publicModelEvents = new Set(['text-delta', 'reasoning-delta', 'tool-call', 'tool-result', 'finish-step']) // 只广播界面真实消费的稳定模型事件


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
  let field
  if (definition.enum) field = z.enum(definition.enum)                  // 枚举字段限制到配置允许的字符串值
  else if (definition.type === 'number') field = z.number()             // 数值字段拒绝模型生成的字符串
  else if (definition.type === 'boolean') field = z.boolean()           // 布尔字段拒绝模糊真值
  else if (definition.type === 'array') field = z.array(createSchemaField(definition.items)) // 数组递归验证每个元素
  else if (definition.type === 'object') field = createSchema(definition.properties) // 对象递归验证全部属性
  else {
    field = z.string()                                                   // 未声明类型时保持原有字符串默认行为
    if (Number.isFinite(definition.minLength)) field = field.min(definition.minLength) // 将工具声明的字符串边界交给模型协议
    if (Number.isFinite(definition.maxLength)) field = field.max(definition.maxLength) // 防止单次工具参数无限膨胀
  }
  return definition.description ? field.describe(definition.description) : field // JSON Schema 保留参数语义，减少模型畸形调用
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
  if (!definition) return { result: `工具不存在: ${name}`, failed: true } // 工具被热删除时返回可持久化失败结果

  const matched = getPermission(name, input)                             // 每次执行前重新读取权限和命中范围
  if (matched.permission === 'deny') return { result: '该工具已被用户禁止使用。请尝试其他方式完成任务。', denied: true } // deny 不产生副作用并显示拒绝状态
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
      abortSignal,                                                       // 内置、自定义、MCP 和 LSP 工具共享当前 Run 取消信号
      spawnAgent: (prompt, agentID) => runChild(runID, sessionID, prompt, agentID, emit), // 子 Agent 共享环境但使用独立 Run 和模型上下文
    })
  } catch (error) {
    if (abortSignal.aborted) throw new DOMException('tool execution aborted', 'AbortError') // 用户停止立即退出整个 Run
    return { result: `工具执行失败: ${error.message}`, failed: true }      // 工具业务错误变成可恢复且可展示的失败反馈
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
    if (publicModelEvents.has(part.type) && streamWriter) writeEvent(streamWriter, part.type, part) // 工具参数字符流不进入有界事件历史
    if (part.type === 'text-delta') text += part.text                  // 合并文本增量供会话展示
    if (part.type === 'reasoning-delta') reasoning += part.text        // 合并 reasoning 增量供折叠展示
    if (part.type === 'tool-call') toolCalls.push(part)                // 保存本轮工具声明
    if (part.type === 'tool-result') toolResults.push(part)            // 保存本轮工具结果
    if (part.type === 'error' || part.type === 'tool-error') throw normalizeStreamError(part.error) // SDK 协议和工具流错误不能伪装成成功轮次
  }
  if (!text.trim() && !reasoning.trim() && toolCalls.length === 0) {
    const error = new Error('model returned an empty response')         // 空成功无法推进任务，应按上游临时故障处理
    error.statusCode = 503                                              // 复用有限重试预算，禁止额外无限模型轮次
    throw error
  }
  const response = await result.response                               // 取得 AI SDK 为下一轮构造的标准消息
  const usage = await result.usage                                     // 取得本轮真实输入、输出和缓存用量
  const finishReason = await result.finishReason                        // 读取上游是否因长度截断工具 JSON
  if (finishReason === 'length' && toolCalls.length === 0) {
    const error = new Error('model output was truncated before completing a tool call') // 不持久化不可执行的半截参数
    error.statusCode = 422                                              // 相同请求重试无法修复输出边界，直接反馈明确错误
    throw error
  }
  return { response, toolCalls, toolResults, text, reasoning, usage, finishReason } // 将一轮完整数据反馈给循环
}


// --- 统一 SDK 流错误 ---
function normalizeStreamError(error) {
  if (error instanceof Error) return error                              // 保留 AI SDK 原始状态和堆栈
  return new Error(typeof error === 'string' ? error : JSON.stringify(error)) // 非 Error 协议值转换为稳定异常
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
      const childCompletion = getRoundCompletion(round)                          // 完成工具必须在独立轮次确认全部副作用
      if (childCompletion.shouldStop) break                                       // 单独 task_done 或审批拒绝结束子任务
      if (childCompletion.premature) messages.push({ role: 'user', content: 'task_done 不能与其他工具并行作为完成确认。请检查刚才的工具结果，继续完成剩余工作，最后在单独一轮调用 task_done。' }) // 防止部分工作被并行完成调用截断
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
  streamWriter.enqueue(SSE.encode(event, data))                         // 模型内部流使用无 ID 标准帧，Session 广播随后分配递增 ID
}


// --- 启动 Agent 循环并返回 SSE 流 ---
function startLoop({ runID, sessionID, agentID, message, messageID, files = [], request, initialEvents = [] }) {
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
        const attachmentText = files.map((file) => `\n\n[附件: ${file.name}; ${file.type || 'application/octet-stream'}]\n${decodeAttachment(file)}`).join('') // 将真实附件内容加入模型可读上下文
        const modelInput = `${message}${attachmentText}`                   // 用户正文与附件形成同一轮明确输入
        const userMessage = { id: messageID ?? `msg_${crypto.randomUUID()}`, role: 'user', content: message, contentBlocks: [{ type: 'text', text: { text: message } }], files: files.map(({ content, ...file }) => file), checkpoint: null, rolledBack: false, createdAt: Date.now() } // 展示历史只保存附件元数据
        session.messages.push(userMessage)                                // 用户消息加入展示历史
        session.modelMessages.push({ role: 'user', content: modelInput })  // 模型历史包含真实附件内容
        await Session.persist(session)                                    // 用户消息先落盘，崩溃后仍可恢复

        if (session.messages.length === 1) createTitle(sessionID, message, emit).catch(() => {}) // 首条消息异步生成标题，不阻塞主循环
        let textOnlyCount = 0                                             // 连续无工具响应计数，用于兼容模型先说话行为
        let shouldStop = false                                            // 记录工具 stop 或用户中断导致的终止状态
        let usedTools = false                                             // 一旦产生工具调用，本次 Run 必须由 task_done 明确结束

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
          const completion = getRoundCompletion(round)                       // 区分独立完成确认、审批拒绝和过早并行完成
          shouldStop = completion.shouldStop                                  // 只有可靠终态才能结束整个循环
          usedTools ||= round.toolCalls.length > 0                             // 记录任务已经进入真实执行阶段
          session.modelMessages.push(...round.response.messages)             // 将模型消息加入仅供下一轮使用的上下文
          if (completion.premature) session.modelMessages.push({ role: 'user', content: 'task_done 不能与其他工具并行作为完成确认。请检查刚才的工具结果，继续完成用户要求的剩余工作，最后在单独一轮调用 task_done。' }) // 让模型修正尚未验证的完成声明
          const assistantMessage = { id: `msg_${crypto.randomUUID()}`, role: 'assistant', content: round.text, reasoning: round.reasoning, toolCalls: round.toolCalls, contentBlocks: [], checkpoint: round.toolResults.length ? nextStep : null, rolledBack: false, createdAt: Date.now() } // 构建前端可直接渲染的助手消息
          if (round.reasoning) assistantMessage.contentBlocks.push({ type: 'thinking', thinking: { thinking: round.reasoning } }) // 推理进入可折叠内容块
          if (round.text) assistantMessage.contentBlocks.push({ type: 'text', text: { text: round.text } }) // 正文进入 Markdown 文本块
          round.toolCalls.forEach((call) => {
            const output = round.toolResults.find((part) => part.toolCallId === call.toolCallId)?.output // 查找同一次工具调用的真实结果
            const status = output?.denied ? 'rejected' : output?.failed ? 'failed' : 'completed' // 按拒绝、失败或成功保存准确状态
            assistantMessage.contentBlocks.push({ type: 'tool_call', tool_call: { toolCallId: call.toolCallId, toolName: call.toolName, input: call.input, status } }) // 工具声明进入展示条
          })
          session.messages.push(assistantMessage)                          // 完整助手消息一次加入展示历史
          round.toolResults.forEach((part) => session.messages.push({ id: `msg_${crypto.randomUUID()}`, role: 'tool', content: '', contentBlocks: [{ type: 'tool_result', tool_result: { toolCallId: part.toolCallId, output: part.output, isError: Boolean(part.output?.failed) } }], toolCallId: part.toolCallId, name: part.toolName, input: round.toolCalls.find((call) => call.toolCallId === part.toolCallId)?.input, result: part.output, status: part.output?.denied ? 'rejected' : 'completed', step: nextStep, checkpoint: nextStep, rolledBack: false, createdAt: Date.now() })) // 并行结果保存真实拒绝或完成状态
          await Session.persist(session)                                     // 每轮模型与工具反馈完成后立即持久化
          emit('usage', round.usage)                                          // 独立反馈本轮真实 token 用量
          emit('context', { used: Number(round.usage?.inputTokens ?? 0) + Number(round.usage?.outputTokens ?? 0), limit: Config.getContextLimitFor(agent.provider, agent.model), ratio: (Number(round.usage?.inputTokens ?? 0) + Number(round.usage?.outputTokens ?? 0)) / Config.getContextLimitFor(agent.provider, agent.model) }) // 反馈上下文 token 和占比
          if (round.toolResults.length) emit('checkpoint', { step: nextStep, toolCallIds: round.toolResults.map((part) => part.toolCallId) }) // 让实时工具立即获得回退步骤
          if (round.toolResults.length) textOnlyCount = 0                     // 工具执行后重新计算纯文本偏离次数
          else textOnlyCount += 1                                             // 纯文本响应进入协议偏离计数
          if (textOnlyCount && usedTools) session.modelMessages.push({ role: 'user', content: '你已经开始使用工具，任务尚未通过 task_done 明确完成。请检查用户要求和已有工具结果，继续执行剩余工作；全部完成后在单独一轮调用 task_done。' }) // 每次偏离都推动 Agent 返回执行链
          else if (textOnlyCount === 2) session.modelMessages.push({ role: 'user', content: '如果任务尚未完成，请使用工具执行；如果只是简单问答，请直接给出最终答案。' }) // 未使用工具的普通问答允许自然结束
          if (textOnlyCount >= 3 && usedTools) throw new Error('agent stopped using tools before task_done confirmed completion') // 已执行任务不能伪装成成功
          if (textOnlyCount >= 3) shouldStop = true                           // 普通纯文本问答连续稳定后正常结束
        }
        if (stopSignal.signal.aborted) {
          Run.cancel(run.id, String(stopSignal.signal.reason || 'cancelled')) // 循环因用户停止退出时保持取消语义
          writeEvent(streamWriter, 'finish', { ok: false, cancelled: true, sessionID, runID: run.id, agentID: run.agentID }) // 不把主动停止伪装成成功
        } else {
          Run.complete(run.id, { sessionID })                             // 记录本次 Run 完成事实
          writeEvent(streamWriter, 'finish', { ok: true, sessionID, runID: run.id, agentID: run.agentID }) // 反馈完整执行归属
        }
      } catch (error) {
        if (stopSignal.signal.aborted) {
          Run.cancel(run.id, String(stopSignal.signal.reason || 'cancelled')) // 主动停止进入取消态
          writeEvent(streamWriter, 'finish', { ok: false, cancelled: true, sessionID, runID: run.id, agentID: run.agentID }) // 任意中断路径都提供统一终态反馈
        } else {
          Run.fail(run.id, error)                                             // 未知故障进入失败态
          if (error?.name !== 'AbortError') writeEvent(streamWriter, 'error', { message: String(error) }) // 非主动错误反馈真实原因
        }
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


// --- 判断一轮工具结果是否可以结束任务 ---
function getRoundCompletion(round) {
  const stopped = round.toolResults.filter((part) => part.output?.stop === true) // 收集明确要求终止循环的工具结果
  const denied = stopped.some((part) => part.output?.denied === true)             // 用户拒绝必须立即终止，不能诱导模型绕过权限
  const taskDone = stopped.some((part) => part.toolName === 'task_done')           // 正常完成只能由任务结束工具声明
  const taskDoneOnly = taskDone && round.toolCalls.length === 1 && round.toolCalls[0]?.toolName === 'task_done' // 完成确认必须独占一轮
  return { shouldStop: denied || taskDoneOnly, premature: taskDone && !taskDoneOnly } // 并行 task_done 只触发继续检查
}


// --- 在后台启动 Agent 循环 ---
function startBackground({ runID, sessionID, message, messageID, files = [], initialEvents = [] }) {
  const requestController = new AbortController()                         // 后台执行不绑定发送请求的网络连接
  const stream = startLoop({ runID, sessionID, message, messageID, files, request: { signal: requestController.signal }, initialEvents }) // 复用稳定模型循环产生事件
  const session = Session.getMutable(sessionID)                           // 读取需要公开运行状态的真实会话
  session.status = 'running'                                              // `/session/send` 返回前先进入运行态
  Session.persist(session).catch(() => {})                                // 状态持久化失败由最终 Run 错误继续暴露

  void (async () => {
    const reader = stream.getReader()                                     // 后台消费原模型流，避免依赖任何 HTTP 客户端
    const decoder = new TextDecoder()                                     // 将模型事件字节恢复为标准 SSE 文本
    let pending = ''                                                      // 保存跨数据块的不完整事件帧
    try {
      while (true) {
        const { done, value } = await reader.read()                        // 持续读取直到 Run 进入终态
        pending += decoder.decode(value, { stream: !done })                // 合并可能拆开的 UTF-8 字符
        const frames = pending.split('\n\n')                              // 标准 SSE 空行分隔完整事件
        pending = frames.pop() ?? ''                                       // 未完成帧留给下一批网络字节
        for (const frame of frames) {
          const name = frame.match(/^event: (.+)$/m)?.[1]                  // 提取原循环事件名称
          const dataText = frame.match(/^data: (.+)$/m)?.[1]               // 提取原循环 JSON 数据
          if (!name || !dataText) continue                                 // 忽略空帧或非业务行
          const data = JSON.parse(dataText)                                // 原循环保证所有数据可 JSON 序列化
          Event.emit(sessionID, name, data)                                // 写入递增历史并广播独立订阅者
        }
        if (done) break                                                    // Run 流关闭后结束后台消费
      }
    } finally {
      const current = Session.getMutable(sessionID)                        // 会话可能在极端情况下已被删除
      if (current) {
        current.status = 'idle'                                            // 任意终态都退出运行状态
        await Session.persist(current).catch(() => {})                      // 最终状态尽力同步到磁盘
      }
    }
  })()
  return Run.toPublicRun(Run.get(runID))                                   // 发送接口立即反馈可停止的 Run 身份
}


// --- 从兼容入口发送消息并返回模型流 ---
async function sendLegacy({ sessionID, agentID, message, messageID, request }) {
  let targetSessionID = sessionID                                          // 已有会话继续原消息历史
  const initialEvents = []                                                 // 新会话和新 Run 按顺序反馈身份
  if (!targetSessionID) {
    const created = await Session.create({ agentID })                       // 兼容入口省略会话时创建默认工作区会话
    if (created.ok === false) return created                               // 默认工作区异常时反馈指令错误
    targetSessionID = created.id                                           // 后续循环使用真实会话身份
    initialEvents.push({ event: 'session-created', data: { id: targetSessionID } }) // 首个事件通知客户端保存身份
  }
  if (!Session.get(targetSessionID)) return { ok: false, status: 404, error: 'session not found' } // 不存在的会话不能写入
  if (isRunning(targetSessionID)) return { ok: false, status: 409, error: 'session is running' } // 同一历史禁止并发修改

  const run = Run.create({ sessionID: targetSessionID, agentID, input: message }) // 登记本轮固定 Agent 快照
  initialEvents.push({ event: 'run-created', data: { runID: run.id, agentID: run.agentID, parentRunID: null } }) // 在模型增量前反馈 Run
  try {
    return { ok: true, stream: startLoop({ runID: run.id, sessionID: targetSessionID, message, messageID, request, initialEvents }) } // 返回可由响应层包装的模型流
  } catch (error) {
    Run.fail(run.id, error)                                               // 流创建失败关闭已登记 Run
    if (error.code === 'SESSION_RUNNING') return { ok: false, status: 409, error: error.message } // 处理并发预留竞争
    throw error                                                           // 未知故障保留真实堆栈
  }
}


// --- 向正式 Session 启动后台执行 ---
function sendSession(request) {
  const session = Session.get(request.sessionId)                           // 读取用户指定会话
  if (!session) return { ok: false, status: 404, error: 'session not found' } // 正式入口不能隐式创建会话
  if (isRunning(session.id)) return { ok: false, status: 409, error: 'session is running' } // 同一历史禁止并发写入

  const modelAgent = request.model ? Agent.list().find((agent) => agent.model === request.model) : null // 将显式模型解析为配置 Agent
  if (request.model && !modelAgent) return { ok: false, status: 400, error: 'model is not configured for an agent' } // 未配置模型不能绕过供应商定义
  const agentID = request.agentId || modelAgent?.id || session.agentID     // 本轮显式选择优先，其次复用会话选择
  const run = Run.create({ sessionID: session.id, agentID, input: request.content }) // 先登记可查询 Run
  try {
    const started = startBackground({ runID: run.id, sessionID: session.id, message: request.content, messageID: request.messageId, files: request.files || [], initialEvents: [{ event: 'run-created', data: { runID: run.id, agentID: run.agentID, parentRunID: null } }] }) // 模型输出进入独立事件历史
    return { ok: true, sessionId: session.id, run: started }               // 发送请求立即反馈启动状态
  } catch (error) {
    Run.fail(run.id, error)                                                // 启动失败关闭已经登记的 Run
    if (error.code === 'SESSION_RUNNING') return { ok: false, status: 409, error: error.message } // 处理并发预留竞争
    throw error                                                            // 未知故障交给服务错误边界
  }
}


// --- 解码一个消息附件 ---
function decodeAttachment(file) {
  try { return Buffer.from(file.content || '', 'base64').toString('utf-8') } // 文本与代码附件恢复为模型可读正文
  catch { return '[附件内容无法解码]' }                                    // 损坏附件保留明确反馈而不中断整轮消息
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
  if (!runID) return { ok: false, status: 404, error: 'session is not running' }   // 没有运行循环时反馈真实未找到状态
  Run.cancel(runID, 'stopped by user')                                             // 中断目标 Run 并向下传播到子 Run
  return { ok: true }                                                             // 反馈停止信号已发出
}


// --- 判断会话是否正在运行 ---
function isRunning(sessionID) {
  return runningLoops.has(sessionID)                                             // 回退和删除可据此避免与主流写入竞争
}


export const Chat = { startLoop, startBackground, sendLegacy, sendSession, stop, isRunning } // 导出兼容流、正式后台发送和停止动作
