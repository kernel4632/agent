/*
 * 会话运行：发送消息、继续、停止，以及把 Agent 的每个过程变成 SSE。
 *
 * 真正的模型请求和工具循环由 @kernel4632/agent-core 负责；这里只管启动、落盘和收尾。
 * 调用示例：
 *   await Run.send({ sessionId: 'session-1', input: '修一下这个 bug' })
 *   await Run.resume({ sessionId: 'session-1' })
 *   await Run.stop({ sessionId: 'session-1', partial })
 */

import { nanoid } from 'nanoid'
import Approval from '../safety/approval.js' // 工具执行前过同一道审批关口。
import Rules from '../config/rules.js' // 发消息前重读项目规则。
import Config from '../config/config.js' // 模型连接配置。
import Settings from '../config/settings.js' // 会话设置。
import History from './history.js' // 历史落盘。
import Meta from './meta.js' // 读取会话资料。
import AgentSession from './agent.js' // 获取当前 Agent。
import Snapshot from './snapshot.js' // 命令改文件的检查点。
import Store from '../store.js' // 运行令牌和自动批准计数。
import SSE from '../utils/sse.js' // 把运行过程反馈给前端。
import Title from './title.js' // 第一次聊完让模型起个标题。
import { canonical } from '../tool-names.js' // 旧工具名也能认出对应结果。
import fail from '../utils/fail.js' // 输入为空、会话在跑等业务错误。

// --- 启动 Agent 任务 ---
const send = ({ sessionId, input }) => run({ sessionId, input })

const RESUME_INPUT = '继续'
// 还没起标题的会话叫这个名字；自动起标题只看它，用户手动改过就不再覆盖。
const UNTITLED = '新对话'
// 继续被中断的助手回复：只在发送时占位，onStart 里会从历史删掉。
// 这样模型看到的历史末尾仍然是上一段助手回复或工具结果，不会知道“中途被打断过”。
const resume = ({ sessionId }) => run({ sessionId, input: RESUME_INPUT, resume: true })

// --- 取一条消息里的纯文本 ---
// 继续提示可能是字符串，也可能是内容块数组，两种都要能核对。
const textOf = message => {
    if (typeof message?.content === 'string') return message.content          // 简单文本消息
    const parts = Array.isArray(message?.content) ? message.content : []      // 内容块数组或空数组
    return parts
        .filter(part => part?.type === 'text')                                // 只取正文块
        .map(part => part.text || '')                                         // 空块按空字符串
        .join('')                                                             // 拼回一整段
}

// --- 把一次模型请求的用量收成固定字段 ---
// agent-core 不同协议返回的字段名略有差别，进历史前统一，前端只认这一套。
const usageOf = ({ usage, startedAt, finishedAt }) => {
    const input = Number(usage?.inputTokens ?? usage?.promptTokens ?? 0)
    const output = Number(usage?.outputTokens ?? usage?.completionTokens ?? 0)
    return {
        input,
        output,
        // AI SDK 把缓存放在 inputTokenDetails 里；旧字段保留给兼容数据。
        cacheRead: Number(usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cacheReadTokens ?? usage?.cachedInputTokens ?? 0),
        cacheWrite: Number(usage?.inputTokenDetails?.cacheWriteTokens ?? usage?.cacheWriteTokens ?? 0),
        reasoning: Number(usage?.outputTokenDetails?.reasoningTokens ?? usage?.reasoningTokens ?? 0),
        total: Number(usage?.totalTokens ?? input + output),
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
    }
}

// 一次模型请求结束时，把用量挂到刚追加的那条助手消息上，刷新后还能看到。
const attachUsage = ({ agent, usage }) => {
    if (!usage) return
    const message = [...agent.history].reverse().find(item => item.role === 'assistant' && !item.usage)
    if (message) message.usage = usage
}

// --- 删掉继续占位 ---
// agent.send 的接口要求必须传 input，并且会把它原样追加成一条 user 消息。
// 继续时先传占位，再在第一次模型请求前删掉：历史长度和内容都对上才删，
// 对不上说明历史被别的写入动过，宁可停下也不能误删真正的用户消息。
const dropResumeInput = ({ agent, previousLength }) => {
    const marker = agent.history.at(-1)                               // 发送后末尾应该就是占位
    if (agent.history.length !== previousLength + 1) return false     // 条数不对，不碰历史
    if (marker?.role !== 'user' || textOf(marker) !== RESUME_INPUT) return false // 不是占位，不碰历史
    agent.history.pop()                                               // 删掉占位，恢复成发送前的历史
    return true
}

// --- 把 Agent 内存里的新消息同步到历史文件 ---
// 同一个会话的保存串成一条队：两次保存交错时会重复追加同一条消息。
const saveQueue = new Map()
// 每一轮 run 一个 token；只有当前 token 能发终态，避免 stop 和正常完成各发一条。
const activeRuns = new Map()
const stopping = new Set()                                 // stop 处理期间不允许同一会话启动新 run（服务端兜底，不只靠前端）
const finishRun = (sessionId, token) => {
    if (activeRuns.get(sessionId) === token) activeRuns.delete(sessionId)
}
const syncHistory = async ({ sessionId, agent }) => {
    const previous = saveQueue.get(sessionId) || Promise.resolve()
    const task = previous.catch(() => {}).then(async () => {            // 前一次失败也要让后一次继续
        // 先给历史拍个快照。等待写盘期间 Agent 还会继续追加消息，
        // 直接遍历 agent.history 会边读边变，容易漏掉或重复。
        const messages = [...agent.history]
        // 已保存过的按消息 id 去重；internal 的内部提示不写进历史，也不出现在界面上。
        const existing = new Set(History.get({ sessionId }).map(message => message.id))
        for (const message of messages) {
            if (message.internal || existing.has(message.id)) continue // 内部提示和旧消息都跳过
            existing.add(message.id)                                  // 同一次任务后面的保存不再重复写
            await History.add({ sessionId, message })
        }
        // 完整步骤落盘后清掉已经包含在其中的事件；后续事件留待断线重连。
        await History.save({ sessionId })
    })
    saveQueue.set(sessionId, task)
    // 队列只负责串行；失败要留下是哪个会话、什么原因，不能静默吞掉。
    task.finally(() => { if (saveQueue.get(sessionId) === task) saveQueue.delete(sessionId) })
        .catch(error => console.error(`[session ${sessionId}] 保存历史失败：${error.message}`))
    return task
}

// --- 继续占位识别失败时的收尾：只发错误，不保存半段 ---
const finishResumeError = async ({ sessionId, token, resumeError }) => {
    if (token.stopped) return                               // stop 接管终态
    if (activeRuns.get(sessionId) !== token) return finishRun(sessionId, token) // 新 run 的事件不能清
    await SSE.reset({ id: sessionId })                       // 只有当前 run 才能清旧终态
    await SSE.send({ id: sessionId, data: { type: 'agent-finish', error: resumeError } })
    finishRun(sessionId, token)
}

// --- 任务成功后的收尾：保存、起标题、通知前端 ---
const finishSuccess = async ({ sessionId, token, agent, meta, settings, resume, result }) => {
    if (token.stopped) return                                      // stop 拥有终态，等它统一收尾
    if (activeRuns.get(sessionId) !== token) return finishRun(sessionId, token)
    await syncHistory({ sessionId, agent })                       // 最终保存：历史稳定，清掉 SSE 缓存
    if (token.stopped) return
    if (activeRuns.get(sessionId) !== token) return finishRun(sessionId, token)
    // 标题在任务成功之后才起：这一轮有没有跑通，直接决定标题该不该花这次请求。
    if (!resume) await titleFor({ sessionId, meta, settings, agent })
    if (token.stopped) return
    if (activeRuns.get(sessionId) !== token) return finishRun(sessionId, token)
    // 缓存清完再通知，前端刷新时读到的是完整历史，不会和补发事件打架。
    await SSE.send({ id: sessionId, data: { type: 'agent-finish', ...result } })
    finishRun(sessionId, token)
}

// --- 任务失败后的收尾：保留已产生的进度，再把错误交给前端 ---
const finishFailure = async ({ sessionId, token, agent, resumeError, error }) => {
    if (resumeError) return finishResumeError({ sessionId, token, resumeError })
    // 被 stop 或新 run 接管的旧任务不能再发终态。
    if (token.stopped) return                                     // stop 统一收尾
    if (activeRuns.get(sessionId) !== token) return finishRun(sessionId, token)
    // 只有 kind=aborted 才是 core 的主动取消；timeout 等即使名字叫 AbortError 也要报错结束。
    if (error?.kind === 'aborted') {
        finishRun(sessionId, token)
        return
    }
    // 失败和中断也要留下已经产生的进度，用户才能从断点继续。
    await syncHistory({ sessionId, agent }).catch(() => {})
    if (token.stopped) return
    if (activeRuns.get(sessionId) !== token) return finishRun(sessionId, token)
    await SSE.send({ id: sessionId, data: { type: 'agent-finish', error: error.message } })
    finishRun(sessionId, token)
}

// --- 发送前检查：输入、停止状态、运行状态和继续位置；不通过就按填错返回 ---
const validateRun = async ({ sessionId, input, resume }) => {
    // 用户输入在这里检查一次：去掉首尾空格后不能为空。
    if (typeof input !== 'string' || !input.trim()) throw fail(400, 'input must be a non-empty string')
    if (stopping.has(sessionId)) throw fail(409, '正在停止上一轮任务，请稍后再试')
    const meta = await Meta.read(sessionId)
    const agent = await AgentSession.get({ sessionId, meta })
    // 读资料/建 Agent 期间 stop 可能已经开始；启动前再查一次，堵住 in-flight send 的窗口。
    if (stopping.has(sessionId)) throw fail(409, '正在停止上一轮任务，请稍后再试')
    if (agent.running) throw fail(409, `Agent is already running: ${sessionId}`) // 服务端也只允许一轮，不能靠前端拦
    // 工具执行完、模型下一轮还没回复时，历史末尾是 role:tool；继续应该看它前面的助手回复。
    if (resume && [...agent.history].reverse().find(message => !message.internal && message.role !== 'tool')?.role !== 'assistant') {
        throw fail(409, '最后一条消息不是助手回复，不能继续')
    }
    return { meta, agent }
}

// --- 开跑前：处理继续占位、保存用户消息，然后通知前端开始 ---
const startAgent = ({ sessionId, agent, resume, previousLength, token, state }) => async () => {
    // 继续占位要在第一次模型请求前删掉，否则模型会把“继续”当成一条新的用户消息。
    if (resume && !dropResumeInput({ agent, previousLength })) {
        state.resumeError = '继续占位没有出现在历史末尾，已停止本次继续'
        await SSE.reset({ id: sessionId })                // 先清掉上一轮旧终态，失败只留新的错误事件
        void agent.stop()                                 // 不能 await：onStart 正在被这一轮 await
        return
    }
    // 开跑前保存用户消息/恢复前的进度；这时 agent-start 还没发，可以安全清掉上一轮缓存。
    await syncHistory({ sessionId, agent })
    if (token.stopped || activeRuns.get(sessionId) !== token) return // 保存期间已被 stop 接管，不再发开始事件
    await SSE.send({ id: sessionId, data: { type: resume ? 'agent-resume' : 'agent-start' } })
}

// --- 模型请求的开始和结束：记录耗时和用量，界面据此画请求行 ---
const modelEvents = ({ sessionId, state }) => ({
    onLLMStart: request => {
        state.llmStartedAt = Date.now()
        return SSE.send({ id: sessionId, data: { type: 'llm-start', ...request } })
    },
    onLLMFinish: result => {
        const finishedAt = Date.now()
        state.pendingUsage = usageOf({ usage: result.usage, startedAt: state.llmStartedAt || finishedAt, finishedAt })
        // 用量在服务端统一成固定字段再发给前端，前端不再认识各家模型的原始字段名。
        return SSE.send({ id: sessionId, data: { type: 'llm-finish', ...result, usage: state.pendingUsage, durationMs: state.pendingUsage.durationMs } })
    },
})

// --- 原样转发给前端的事件：前端只认事件类型 ---
const forwardedEvents = ({ sessionId }) => ({
    onLLMEvent: event => SSE.send({ id: sessionId, data: event }),
    onRetry: info => SSE.send({ id: sessionId, data: { type: 'retry', ...info } }),
    onToolCall: call => SSE.send({ id: sessionId, data: { ...call, type: 'tool-call' } }),
    onToolOutput: output => SSE.send({ id: sessionId, data: { ...output, type: 'tool-output' } }),
    onCompact: event => SSE.send({ id: sessionId, data: event }),
})

// --- 工具结果：命令结束后记一次文件检查点，再把结果推给前端 ---
const sendToolResult = ({ sessionId }) => result => {
    // execute_command 改了哪些文件只有跑完才知道；和命令前的清单对比后记一次检查点。
    const toolCallId = result.toolCallId || result.callID
    if (canonical(result.toolName) === 'execute_command' && toolCallId) {
        Snapshot.endShell({ sessionId, toolCallId }).catch(() => {})
    }
    SSE.send({ id: sessionId, data: { ...result, type: 'tool-result' } })
}

// --- 每完成一步就落盘；agent-core 会 await 这个回调，保存期间不会再有新事件 ---
const saveStep = ({ sessionId, agent, state }) => () => {
    attachUsage({ agent, usage: state.pendingUsage })
    state.pendingUsage = null
    return syncHistory({ sessionId, agent }).catch(error => {
        console.error(`[session ${sessionId}] 步骤保存失败：${error.message}`)
    })
}

// --- 工具审批：快照同时记下"哪条用户消息"和"哪次工具调用" ---
const askBeforeTool = ({ sessionId, agent }) => ({ toolCallId, toolName, input, signal }) => Approval.check({
    sessionId,
    // messageId 必须在这时候才取：Agent 内部要先 await 停止上一个任务，才会把用户消息写进历史，
    // send 一返回就取会取到上一轮的那条。这里已经是跑工具的阶段，消息早就进去了。
    // 也不要自己造一个 id —— 那样和历史里那条对不上，回退会找不到快照。
    messageId: agent.history.findLast(message => message.role === 'user' && !message.internal)?.id,
    toolCallId,
    toolName,
    input,
    signal,
})

// --- 真正启动这一轮：把 Agent 的每个过程转成 SSE，并返回任务和收尾状态 ---
const startRun = async ({ sessionId, input, resume, meta, agent }) => {
    // 这一轮用哪份配置：主模型加上用户为压缩单独指定的那个（如果配了）。
    const settings = await Settings.read({ sessionId })
    // 发消息前重读规则，用户刚改过 AGENTS.md 或智能体专属规则也能在这一轮生效。
    await Rules.load({ agent: settings.agent })
    // clearUndo/Settings/Rules 也都是 await；最后启动前再查一次 stop gate。
    if (stopping.has(sessionId)) throw fail(409, '正在停止上一轮任务，请稍后再试')

    const previousLength = agent.history.length                      // 发送前的条数，用来认出刚追加的继续占位
    const token = { stopped: false }                                  // 这一轮的终态令牌；stop 和 task.then 只有一方能结束它
    activeRuns.set(sessionId, token)
    const state = { resumeError: '', llmStartedAt: 0, pendingUsage: null } // 回调之间共享的临时状态
    let task
    try {
        task = agent.send({
            input: input.trim(),
            config: Config.resolve({ provider: meta.provider, model: meta.model, settings: Settings.toAgentConfig({ settings }) }),
            callbacks: {
                onStart: startAgent({ sessionId, agent, resume, previousLength, token, state }),
                ...modelEvents({ sessionId, state }),
                ...forwardedEvents({ sessionId }),
                onToolResult: sendToolResult({ sessionId }),
                onStep: saveStep({ sessionId, agent, state }),
                onPermission: askBeforeTool({ sessionId, agent }),
            },
        })
    } catch (error) {
        finishRun(sessionId, token)                                    // 启动失败也要释放 token
        throw error
    }
    return { task, token, settings, state }
}

// --- 发送消息；真正的 Agent 循环在 agent-core 里 ---
const run = async ({ sessionId, input, resume = false }) => {
    const { meta, agent } = await validateRun({ sessionId, input, resume })

    // 新消息代表新的时间线，之前的回退不能再撤销了。
    await Snapshot.clearUndo({ sessionId })
    // 自动批准的计数也跟着归零：用户刚发了新指令，是新的开始。
    Store.autoApproved.set(sessionId, 0)
    // 重复调用的判断也重新开始，上一轮的连续重试不该影响这一轮。
    Store.recentCalls.delete(sessionId)

    const { task, token, settings, state } = await startRun({ sessionId, input, resume, meta, agent })
    // 先挂上收尾处理：即使继续提示校验失败，任务 Promise 也不会无人接收。
    // 只有当前 run token 才能收尾；被 stop 或新 run 接管的旧任务直接退出。
    task
        .then(result => state.resumeError
            ? finishResumeError({ sessionId, token, resumeError: state.resumeError })
            : finishSuccess({ sessionId, token, agent, meta, settings, resume, result }))
        .catch(error => finishFailure({ sessionId, token, agent, resumeError: state.resumeError, error }))
    // 收尾处理已经挂在 task 上；继续提示的识别和首次保存都在 onStart 里完成。
    return { ok: true }
}

/**
 * 第一次聊完之后给会话起个标题。
 *
 * 只在这几种情况下动手，其余一律跳过：
 *   - 用户开着自动起标题（关掉就一直叫"新对话"，这是他的选择）
 *   - 还没有标题（用户改过标题就不该被覆盖掉）
 *   - 历史里已经有一轮问答（第一句话就是起标题的依据）
 * @param {{ sessionId: string, meta: object, settings: object, agent: object }} context
 * @returns {Promise<void>} 起不出标题也照常返回，不影响这一轮。
 */
const titleFor = async ({ sessionId, meta, settings, agent }) => {
    if (!settings.autoTitle) return
    const fresh = await Meta.read(sessionId)
    if (fresh.title !== UNTITLED) return

    // 起标题用哪份连接：用户为"标题"单独指定过就用那个，否则和主模型共用。
    const target = settings.uses?.title || { provider: meta.provider, model: meta.model }
    const title = await Title.generate({
        connection: Config.connection(target),
        // 用写回磁盘的那份历史，不是 agent 手里的——回退过的历史已经落在磁盘上了。
        messages: History.get({ sessionId }),
    })
    // 起不出来（模型连不上等）就保持"新对话"，不要往界面上推一条空标题。
    if (!title) return

    fresh.title = title
    fresh.updatedAt = Date.now()
    await Meta.write(fresh)
    // 告诉界面新标题是什么，免得侧边栏要等下一次刷新才变。
    await SSE.send({ id: sessionId, data: { type: 'title', title } })
}

// --- 停止 Agent 任务 ---
/**
 * 停止时把界面上已经流出的半段回复补进历史；agent-core 只在 llm-finish 后才会保存 assistant 消息。
 * @param {{ agent: object, partial?: { content?: string, reasoning?: string } }} input
 */
const appendPartial = ({ agent, partial }) => {
    if (!partial) return                                                    // 没传就只保存 agent 已有进度
    const content = typeof partial.content === 'string' ? partial.content.trim() : ''
    const reasoning = typeof partial.reasoning === 'string' ? partial.reasoning.trim() : ''
    if (!content && !reasoning) return                                     // 没有可见内容，不造空消息

    const last = agent.history.at(-1)                                      // 已经落盘的完整消息不要重复
    if (last?.role === 'assistant' && content && textOf(last).includes(content)) return
    agent.history.push({
        id: nanoid(),
        role: 'assistant',
        content: [
            ...(reasoning ? [{ type: 'reasoning', text: reasoning }] : []), // 思考内容按历史格式保存
            ...(content ? [{ type: 'text', text: content }] : []),          // 可见正文按文本块保存
        ],
    })
}

const stop = async ({ sessionId, partial }) => {
    // partial 是前端传来的半段回复；格式不对属于用户输入错误，在入口一次挡住。
    if (partial != null && (typeof partial !== 'object' || Array.isArray(partial))) {
        throw fail(400, 'partial must be an object')
    }
    const agent = Store.agents.get(sessionId)
    if (!agent) return { ok: false }
    if (stopping.has(sessionId)) return { ok: false }                       // 已经有一次停止在处理
    stopping.add(sessionId)                                                // 服务端挡住 stop 期间的新 send
    try {
        const token = activeRuns.get(sessionId)                            // 这一轮自己的终态令牌
        const wasRunning = Boolean(agent.running)                          // 先记下有没有真的在跑，stop 返回后 running 会被清掉
        if (token && wasRunning) token.stopped = true                      // 接管终态：task.then/catch 不再发 finish
        const result = await agent.stop()                                  // 先等核心循环完全停下，避免和收尾保存抢历史
        if (activeRuns.get(sessionId) !== token) return result              // 这一轮已经被别人接管，不能再写
        if (result.ok) appendPartial({ agent, partial })                    // 只有真的停掉一轮才补半段，避免空停止写入垃圾
        // 停止是这一轮的最终状态，保存后清掉 SSE 缓存。
        try {
            await syncHistory({ sessionId, agent })
        } catch {
            // stop 的接口约定只有 { ok }，保存失败不能塞进返回值改变契约。
            // syncHistory 已经把"哪个会话、什么原因"写进日志，界面停止后会重新读历史。
        }
        // 这一轮由 stop 接管时只发一次结束事件；task.then/catch 看到 token.stopped 会退出。
        if (token && wasRunning && activeRuns.get(sessionId) === token) {
            await SSE.send({ id: sessionId, data: { type: 'agent-finish', reason: 'stopped' } })
            finishRun(sessionId, token)
        }
        return result
    } finally {
        stopping.delete(sessionId)                                         // 停止处理完才允许下一轮
    }
}


export default { send, resume, stop }
