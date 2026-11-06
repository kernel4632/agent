/*
 * 对话指令：发送、继续、停止和审批决定。
 *
 * 一次运行的编排都在这里：启动 Agent、把过程推成 SSE、保存新消息、收尾。
 * 模型请求和工具循环由 @kernel4632/agent-core 负责；本文件只 import features 和 utils，
 * 不 import 别的命令文件。有状态模块的装配在 server.js。
 *
 * 调用示例：
 *   await Chat.send({ sessionId, input: '你好' })
 *   await Chat.send({ sessionId, input: [{ type: 'text', text: '看这张图' }, { type: 'image', image: 'data:image/png;base64,...' }] })
 *   await Chat.resume({ sessionId })
 *   await Chat.stop({ sessionId })
 *   await Chat.decide({ sessionId, toolCallId, decision: 'allow-once' })
 */

import { nanoid } from 'nanoid'
import Agent from '../features/agent.js'
import Approval from '../features/approval.js'
import History from '../features/history.js'
import Title from '../features/title.js'
import Tool from '../features/tool.js'
import ToolTiming from '../features/tool-timing.js'
import SSE from '../utils/sse.js'
import fail from '../utils/fail.js'
import usageOf from '../utils/usage.js'

// 同一个会话的保存串成一条队：两次保存交错时会重复追加同一条消息。
const saveQueue = new Map()
// 每一轮 run 一个 token；只有当前 token 能发终态。
const activeRuns = new Map()
// stop 处理期间不允许同一会话启动新 run。
const stopping = new Set()

// --- 一轮结束：清运行标记 ---
// 必须 await 落盘：不能留后台 Promise。测试切 AGENT_HOME、进程正在退出、
// 或用户马上又发下一句时，悬着的写入会落到错误的目录或晚到而覆盖新状态。
const finishRun = async (sessionId, token) => {
    if (activeRuns.get(sessionId) === token) activeRuns.delete(sessionId)
    // 无论本轮是成功还是失败，都把磁盘上的运行标记清掉：下次重启时不再把已结束的会话当作被打断。
    History.setRunning(sessionId, false)
    await History.saveMeta(sessionId).catch(error => console.error(`[session ${sessionId}] 清除运行标记失败：${error.message}`))
    await Agent.settle(sessionId)
}

// --- 取一条消息里的纯文本 ---
const textOf = message => {
    if (typeof message?.content === 'string') return message.content
    const parts = Array.isArray(message?.content) ? message.content : []
    return parts.filter(part => part?.type === 'text').map(part => part.text || '').join('')
}

// --- 一次模型请求结束时，把用量挂到刚追加的那条助手消息上 ---
const attachUsage = ({ agent, usage }) => {
    if (!usage) return
    const message = [...agent.history].reverse().find(item => item.role === 'assistant' && !item.compact && !item.usage)
    if (message) message.usage = usage
}

// 压缩用量记在本轮追加的 compact 项，不覆盖旧总结或普通回答。
const attachCompactUsage = ({ agent, state }) => {
    if (!state?.pendingCompactUsage) return
    for (const message of agent.history.slice(state.compactStartIndex)) {
        if (!message.compact || message.usage) continue
        const usage = state.pendingCompactUsage.shift()
        if (usage) message.usage = usage
    }
}

// --- 把 Agent 内存里的新消息同步到历史文件 ---
const syncHistory = async ({ sessionId, agent }) => {
    const previous = saveQueue.get(sessionId) || Promise.resolve()
    const task = previous.catch(() => {}).then(async () => {
        // 先给历史拍个快照，等待写盘期间 Agent 还会继续追加消息。
        const messages = [...agent.history]
        const existing = new Set(History.get({ sessionId }).map(message => message.id))
        for (const message of messages) {
            if (message.internal || existing.has(message.id)) continue
            existing.add(message.id)
            await History.add({ sessionId, message })
        }
        await History.save(sessionId)
    })
    saveQueue.set(sessionId, task)
    task.finally(() => { if (saveQueue.get(sessionId) === task) saveQueue.delete(sessionId) })
        .catch(error => console.error(`[session ${sessionId}] 保存历史失败：${error.message}`))
    return task
}

// --- 任务成功后的收尾：保存、起标题、通知前端 ---
const finishSuccess = async ({ sessionId, token, agent, resume, result }) => {
    if (token.stopped) return
    if (activeRuns.get(sessionId) !== token) return finishRun(sessionId, token)
    await syncHistory({ sessionId, agent })
    if (token.stopped) return
    if (activeRuns.get(sessionId) !== token) return finishRun(sessionId, token)
    // 标题在任务成功之后才起：这一轮有没有跑通，直接决定标题该不该花这次请求。
    if (!resume) await titleFor({ sessionId })
    if (token.stopped) return
    if (activeRuns.get(sessionId) !== token) return finishRun(sessionId, token)
    await SSE.send({ id: sessionId, data: { type: 'agent-finish', ...result } })
    await finishRun(sessionId, token)
}

// --- 任务失败后的收尾：保留已产生的进度，再把错误交给前端 ---
const finishFailure = async ({ sessionId, token, agent, state, error }) => {
    if (token.stopped) return
    if (activeRuns.get(sessionId) !== token) return finishRun(sessionId, token)
    // 只有 kind=aborted 才是 core 的主动取消；timeout 等仍要报错结束。
    if (error?.kind === 'aborted') {
        await finishRun(sessionId, token)
        return
    }
    attachCompactUsage({ agent, state })
    await syncHistory({ sessionId, agent }).catch(() => {})
    if (token.stopped) return
    if (activeRuns.get(sessionId) !== token) return finishRun(sessionId, token)
    await SSE.send({ id: sessionId, data: { type: 'agent-finish', error: error.message } })
    await finishRun(sessionId, token)
}

// --- 输入归一化：纯文本原样；内容块数组校验后原样交给 core（图片由 core 转成各家协议）---
// 图片只认 data URL 和 http(s) URL；base64 上限 8M 字符（约 6 MB 原图），防止一次请求撑爆上下文。
const IMAGE_SOURCE = /^(data:image\/(?:png|jpe?g|gif|webp);base64,|https?:\/\/)/
const MAX_IMAGE_CHARS = 8 * 1024 * 1024

const inputHasText = input => typeof input === 'string'
    ? Boolean(input.trim())
    : (Array.isArray(input) && input.filter(part => part?.type === 'text').map(part => part.text || '').join('\n').trim().length > 0)

const normalizeInput = input => {
    if (typeof input === 'string') return input.trim()
    if (!Array.isArray(input)) return null
    const parts = input.filter(part => part && typeof part === 'object' && (part.type === 'text' || part.type === 'image'))
    for (const part of parts) {
        if (part.type === 'image' && (typeof part.image !== 'string' || !IMAGE_SOURCE.test(part.image))) {
            throw fail(400, 'image part must be a data URL or an http(s) URL')
        }
        if (part.type === 'image' && part.image.length > MAX_IMAGE_CHARS) {
            throw fail(400, 'image is too large: base64 form must stay under 8M characters')
        }
    }
    return parts.some(part => part.type === 'text') ? parts : null
}

// --- 发送前检查：输入、停止状态、运行状态和继续位置 ---
const validateRun = async ({ sessionId, input, resume }) => {
    if (!resume && !inputHasText(input)) throw fail(400, 'input must be a non-empty string')
    if (stopping.has(sessionId)) throw fail(409, '正在停止上一轮任务，请稍后再试')

    await History.load(sessionId)
    const agent = await Agent.get({ sessionId })
    if (stopping.has(sessionId)) throw fail(409, '正在停止上一轮任务，请稍后再试')
    if (agent.running) throw fail(409, `Agent is already running: ${sessionId}`)

    if (resume && [...agent.history].reverse().find(message => !message.internal && message.role !== 'tool')?.role !== 'assistant') {
        throw fail(409, '最后一条消息不是助手回复，不能继续')
    }
    return agent
}

// --- 开跑前：先通知前端开始；历史落盘不能挡在模型请求之前，长会话会白等 ---
const startAgent = ({ sessionId, agent, resume, token }) => async () => {
    if (token.stopped || activeRuns.get(sessionId) !== token) return
    await SSE.send({ id: sessionId, data: { type: resume ? 'agent-resume' : 'agent-start' } })
    // 历史保存异步跑，onStep / finish 还会继续落盘；这里不再 await。
    syncHistory({ sessionId, agent }).catch(error => console.error(`[session ${sessionId}] 启动时保存历史失败：${error.message}`))
}

// --- 模型请求的开始和结束：记录首字时间、总耗时和用量 ---
const modelEvents = ({ sessionId, state }) => ({
    onLLMStart: request => {
        // core 每次真实请求都调这里，重试也算；同一个请求只开一行，重试沿用原来的开始时间。
        if (state.requesting) return
        state.requesting = true
        state.llmStartedAt = Date.now()
        state.firstTokenAt = 0
        // 每轮现读 config：运行中切模型后，这一笔就按新供应商/模型记录。
        state.provider = state.agent?.config?.providerName || ''
        state.model = state.agent?.config?.model || ''
        return SSE.send({
            id: sessionId,
            data: { type: 'llm-start', ...request, startedAt: state.llmStartedAt, provider: state.provider, model: state.model },
        })
    },
    onLLMFinish: result => {
        state.requesting = false
        const finishedAt = Date.now()
        state.pendingUsage = usageOf({
            usage: result.usage,
            startedAt: state.llmStartedAt || finishedAt,
            finishedAt,
            firstTokenAt: state.firstTokenAt,
            provider: state.provider,
            model: state.model,
        })
        return SSE.send({
            id: sessionId,
            data: { type: 'llm-finish', ...result, usage: state.pendingUsage, durationMs: state.pendingUsage.durationMs },
        })
    },
})

// --- 原样转发给前端的事件 ---
const contentEvent = event => typeof event?.type === 'string'
    && (event.type.endsWith('-delta') || event.type === 'tool-call' || event.type.startsWith('tool-input'))

const forwardedEvents = ({ sessionId, state }) => ({
    onLLMEvent: event => {
        // 流内部的 error 帧不转发：它只是供应商收尾时的噪音（关流、重试前的失败），
        // 真正的失败由循环 throw 统一变成 agent-finish 的错误终态；
        // 原样转发会让前端把已完成的回答误标成“模型请求失败”。
        if (event?.type === 'error') return
        // 第一次收到内容增量时记下首字时间；重连后前端也能靠这条事件恢复。
        if (!state.firstTokenAt && contentEvent(event)) {
            state.firstTokenAt = Date.now()
            SSE.send({ id: sessionId, data: { type: 'llm-first-token', firstTokenAt: state.firstTokenAt, firstTokenMs: Math.max(0, state.firstTokenAt - (state.llmStartedAt || state.firstTokenAt)) } })
        }
        return SSE.send({ id: sessionId, data: event })
    },
    onRetry: info => SSE.send({ id: sessionId, data: { type: 'retry', ...info } }),
    onToolCall: async call => {
        const startedAt = Date.now()
        const toolCallId = call.toolCallId || call.callID || call.callId || call.id
        await ToolTiming.start({ sessionId, toolCallId, at: startedAt }).catch(() => {})
        return SSE.send({ id: sessionId, data: { ...call, type: 'tool-call', startedAt } })
    },
    onToolOutput: output => SSE.send({ id: sessionId, data: { ...output, type: 'tool-output' } }),
    onCompact: event => {
        const data = { ...event }
        if (event.type === 'compact-start') {
            state.compactStartedAt = Date.now()
            data.startedAt = state.compactStartedAt
        }
        if (event.type === 'compact-finish') {
            const finishedAt = Date.now()
            const usage = usageOf({
                usage: event.usage,
                startedAt: state.compactStartedAt || finishedAt,
                finishedAt,
            })
            state.pendingCompactUsage.push(usage)
            data.usage = usage                       // 统一成界面字段，和 llm-finish 一样
            data.durationMs = usage.durationMs
        }
        return SSE.send({ id: sessionId, data })
    },
})

// --- 工具结果原样推给前端 ---
const elapsedLabel = milliseconds => `${Math.max(0, Math.round((Number(milliseconds) || 0) / 1000))}s`

// 用户主动停止时 core 只返回一句“工具执行已中断”；补上已经跑的时间，
// 让模型和界面都知道这个工具实际执行了多久。
const annotateInterruption = (result, timing) => {
    const output = result?.output
    if (output?.type !== 'error-text' || !timing) return
    const text = String(output.value || '')
    if (!/工具执行已(中断|取消)/.test(text) || /已执行/.test(text)) return
    output.value = `${text}（已执行 ${elapsedLabel(timing.durationMs)}）`
}

const sendToolResult = ({ sessionId }) => async result => {
    const finishedAt = Date.now()
    const timing = await ToolTiming.finish({
        sessionId,
        toolCallId: result.toolCallId || result.callID || result.callId || result.id,
        at: finishedAt,
    }).catch(() => null)
    annotateInterruption(result, timing)
    await SSE.send({ id: sessionId, data: { ...result, type: 'tool-result', ...(timing || {}) } })
}

// --- 每完成一步就落盘 ---
const saveStep = ({ sessionId, agent, state }) => () => {
    attachCompactUsage({ agent, state })
    attachUsage({ agent, usage: state.pendingUsage })
    state.pendingUsage = null
    return syncHistory({ sessionId, agent }).catch(error => {
        console.error(`[session ${sessionId}] 步骤保存失败：${error.message}`)
    })
}

// --- 工具审批：同时留下"哪条用户消息"和"哪次工具调用" ---
const askBeforeTool = ({ sessionId, agent }) => ({ toolCallId, toolName, input, signal }) => Approval.check({
    sessionId,
    messageId: agent.history.findLast(message => message.role === 'user' && !message.internal)?.id,
    toolCallId,
    toolName,
    input,
    signal,
})

// --- 真正启动这一轮 ---
// --- 上下文余量提醒：距压缩点只剩 5% 预算时，往下一笔请求临时插一句，让模型收口 ---
// 阈值从 compact.threshold 推导（压缩点 = budget * compactThreshold，提醒点再往前留 5%），
// 用户把压缩阈值调低时提醒点自动跟着挪，两套阈值永不脱钩——这是调研 Claude Code /
// Codex / Gemini CLI 后选的设计：用 token 余量而不是独立百分比。
// 每个 run 只提醒一次（state.compactReminded 记录），不每轮都插：常驻提醒自己也会占上下文。
// onInject 由 core 在每轮请求前调用（压缩之后拿到的才是这一轮真实估算），钩子抛错时 core 已容错。
const CONTEXT_MARGIN = 0.05
const CONTEXT_REMINDER = '[System reminder] The context is close to the compaction threshold. Wrap up cleanly: finish the current step, call attempt_completion with a complete handover (or update the todo list with the next concrete step and the key file paths), so the conversation can be summarized without losing your place. Do not start large new work this turn.'
const compactWarning = ({ state }) => ({ tokens, budget, compactThreshold }) => {
    if (state.compactReminded) return ''                                   // 这个 run 已经提醒过，不重复
    if (!Number.isFinite(budget)) return ''                                // 没有预算就没有压缩，不提醒
    const compactPoint = budget * compactThreshold
    if (tokens < compactPoint - budget * CONTEXT_MARGIN) return ''          // 还没到提醒带
    state.compactReminded = true
    return CONTEXT_REMINDER
}

const startRun = async ({ sessionId, input, resume, agent, recovery = false }) => {
    const session = await History.load(sessionId)
    const settings = await Agent.readSettings(sessionId)
    if (stopping.has(sessionId)) throw fail(409, '正在停止上一轮任务，请稍后再试')

    // 落盘“运行中”，重启后才有线索知道这个会话被意外打断。
    // await：标记必须在模型请求之前真的落到磁盘，否则进程刚好在写入前被杀死就没有线索。
    // 一次小文件写入，代价可以忽略。
    History.setRunning(sessionId, true)
    await History.saveMeta(sessionId).catch(error => console.error(`[session ${sessionId}] 保存运行标记失败：${error.message}`))

    const state = { agent, llmStartedAt: 0, firstTokenAt: 0, requesting: false, pendingUsage: null, compactStartedAt: 0, compactStartIndex: agent.history.length, pendingCompactUsage: [], compactReminded: false }
    const token = { stopped: false, state }
    activeRuns.set(sessionId, token)
    let task
    try {
        const options = {
            config: await Agent.resolve({ session, settings, recovery }),
            callbacks: {
                onStart: startAgent({ sessionId, agent, resume, token }),
                onInject: compactWarning({ state }),
                ...modelEvents({ sessionId, state }),
                ...forwardedEvents({ sessionId, state }),
                onToolResult: sendToolResult({ sessionId }),
                onStep: saveStep({ sessionId, agent, state }),
                onPermission: askBeforeTool({ sessionId, agent }),
            },
        }
        task = resume ? agent.resume(options) : agent.send({ ...options, input })
    } catch (error) {
        await finishRun(sessionId, token)
        throw error
    }
    return { task, token }
}

const run = async ({ sessionId, input, resume = false, recovery = false }) => {
    const agent = await validateRun({ sessionId, input, resume })
    // 归一化放在这里：resume 不带新输入；非法图片块在启动前就报 400。
    const payload = resume ? undefined : normalizeInput(input)

    // 新消息代表新的时间线，之前的回退不能再撤销；计数也重新开始。
    await Tool.clearUndo({ sessionId })
    Approval.reset(sessionId)

    const { task, token } = await startRun({ sessionId, input: payload, resume, agent, recovery })
    task
        .then(result => finishSuccess({ sessionId, token, agent, resume, result }))
        .catch(error => finishFailure({ sessionId, token, agent, state: token.state, error }))
    return { ok: true }
}

// --- 结束工具：它们的结果在历史里说明任务其实已经正常收尾 ---
const isStopResult = part => part?.type === 'tool-result' && (part.toolName === 'attempt_completion' || part.toolName === 'ask_followup_question')

// --- 会话被意外打断后，末尾是否还有一个可以继续的助手回合 ---
// 末尾悬着一条没有结果的工具调用，也照样能继续：core 在每次请求前都会把
// 没拿到结果的 tool-call 从上下文里摘掉，不会撑坏协议。
const resumable = messages => {
    const last = [...messages].reverse().find(message => !message.internal && message.role !== 'tool')
    return last?.role === 'assistant'
}

// --- 磁盘上的标记说“当时正在运行”，但任务其实已经正常收尾：只清标记，不重发请求 ---
// 并行工具调用时结束工具的结果可能夹在尾部几条 tool 消息中间，所以扫整个尾部 tool 段。
const skipRecovery = messages => {
    for (let index = messages.length - 1; index >= 0 && messages[index].role === 'tool'; index -= 1) {
        if ((messages[index].content || []).some(isStopResult)) return true
    }
    return false
}

// --- 重启后自动接住被打断的任务 ---
// 崩溃或重启时进程里的运行状态全部丢失，磁盘 meta 上的 running 是唯一线索。
// 恢复就是把每条被打断的会话按原逻辑接上：末尾还是助手回合的直接 resume（core 从中断处继续），
// 末尾是用户消息的只清标记（等用户自己发下一句）。收尾由 run 自己负责，成功失败都会清标记。
//
// 三条护栏：
//   1. 恢复走 recovery: true 的配置，重试总时限和次数都封顶，provider 挂掉不会无限空转；
//   2. 串行启动，不同时起多条续跑抢资源；
//   3. 单条失败只记日志并清标记，不拖其他会话，也不拖服务启动。
const recover = async () => {
    const candidates = await History.runningOnDisk()
    const recovered = []
    for (const { id } of candidates) {
        try {
            await History.load(id)
            const agent = await Agent.get({ sessionId: id })
            if (agent.running) continue
            const visible = History.get({ sessionId: id }).filter(message => !message.internal)
            if (skipRecovery(visible) || !resumable(visible)) {
                History.setRunning(id, false)
                await History.saveMeta(id)
                continue
            }
            await run({ sessionId: id, resume: true, recovery: true })
            recovered.push(id)
        } catch (error) {
            // 一条会话恢复失败不该拖垮服务启动，也不该让它永远卡在“运行中”：清掉标记，下轮再说。
            console.error(`[recovery] 会话 ${id} 自动续跑失败：${error.message}`)
            History.setRunning(id, false)
            await History.saveMeta(id).catch(() => {})
        }
    }
    return { recovered }
}

// --- 第一次聊完之后给会话起标题 ---
const titleFor = async ({ sessionId }) => {
    const session = await History.load(sessionId)
    if (session.title !== Title.UNTITLED) return

    // 标题用哪份连接：models.title，没配就跟这条会话自己的模型走。
    const target = Agent.taskModel('title', session.model)
    const messages = History.get({ sessionId }).filter(message => !message.internal)
    const title = await Title.generate({
        connection: Agent.connection(target),
        messages,
    })

    // 起不出来就保留用户第一句话；名字只是顺手的好事，不该影响用户干活。
    const final = title || Title.fallback(messages)
    if (!final) return
    session.title = final
    session.updatedAt = Date.now()
    await History.save(sessionId)
    await SSE.send({ id: sessionId, data: { type: 'title', title: final } })
}

// --- 停止时把界面上已经流出的半段回复补进历史 ---
const appendPartial = ({ agent, partial }) => {
    if (!partial) return
    const content = typeof partial.content === 'string' ? partial.content.trim() : ''
    const reasoning = typeof partial.reasoning === 'string' ? partial.reasoning.trim() : ''
    if (!content && !reasoning) return

    const last = agent.history.at(-1)
    if (last?.role === 'assistant' && content && textOf(last).includes(content)) return
    agent.history.push({
        id: nanoid(),
        role: 'assistant',
        content: [
            ...(reasoning ? [{ type: 'reasoning', text: reasoning }] : []),
            ...(content ? [{ type: 'text', text: content }] : []),
        ],
    })
}

const stop = async ({ sessionId, partial }) => {
    if (partial != null && (typeof partial !== 'object' || Array.isArray(partial))) {
        throw fail(400, 'partial must be an object')
    }
    const agent = Agent.runtime().get(sessionId)
    if (!agent) return { ok: false }
    if (stopping.has(sessionId)) return { ok: false }
    stopping.add(sessionId)
    try {
        const token = activeRuns.get(sessionId)
        const wasRunning = Boolean(agent.running)
        if (token && wasRunning) token.stopped = true
        const result = await agent.stop()
        if (activeRuns.get(sessionId) !== token) return result
        if (result.ok) {
            attachCompactUsage({ agent, state: token?.state })
            appendPartial({ agent, partial })
        }
        try {
            await syncHistory({ sessionId, agent })
        } catch {
            // stop 的接口约定只有 { ok }，保存失败已经写进日志。
        }
        if (token && wasRunning && activeRuns.get(sessionId) === token) {
            await SSE.send({ id: sessionId, data: { type: 'agent-finish', reason: 'stopped' } })
            await finishRun(sessionId, token)
        }
        return result
    } finally {
        stopping.delete(sessionId)
    }
}

const send = ({ sessionId, input }) => run({ sessionId, input })
const resume = ({ sessionId }) => run({ sessionId, resume: true })
const decide = input => Approval.decide(input)

export default { send, resume, stop, decide, recover }
