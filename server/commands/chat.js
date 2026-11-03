/*
 * 对话指令：发送、继续、停止和审批决定。
 *
 * 一次运行的编排都在这里：启动 Agent、把过程推成 SSE、保存新消息、收尾。
 * 模型请求和工具循环由 @kernel4632/agent-core 负责；本文件只 import features 和
 * commands/bind.js，不 import 别的命令文件。服务装配写在 bind.js，这里只调用一次。
 *
 * 调用示例：
 *   await Chat.send({ sessionId, input: '你好' })
 *   await Chat.resume({ sessionId })
 *   await Chat.stop({ sessionId })
 *   await Chat.decide({ sessionId, toolCallId, decision: 'allow-once' })
 */

import { nanoid } from 'nanoid'
import store from '../store.js'
import Agent from '../features/agent.js'
import Approval from '../features/approval.js'
import History from '../features/history.js'
import Title from '../features/title.js'
import Tool from '../features/tool.js'
import SSE from '../utils/sse.js'
import fail from '../utils/fail.js'
import usageOf from '../utils/usage.js'
import bind from './bind.js'

// --- 装配有状态 feature 需要的服务；装配内容只写在 commands/bind.js ---
bind()

// 同一个会话的保存串成一条队：两次保存交错时会重复追加同一条消息。
const saveQueue = new Map()
// 每一轮 run 一个 token；只有当前 token 能发终态。
const activeRuns = new Map()
// stop 处理期间不允许同一会话启动新 run。
const stopping = new Set()

const finishRun = (sessionId, token) => {
    if (activeRuns.get(sessionId) === token) activeRuns.delete(sessionId)
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
    finishRun(sessionId, token)
}

// --- 任务失败后的收尾：保留已产生的进度，再把错误交给前端 ---
const finishFailure = async ({ sessionId, token, agent, state, error }) => {
    if (token.stopped) return
    if (activeRuns.get(sessionId) !== token) return finishRun(sessionId, token)
    // 只有 kind=aborted 才是 core 的主动取消；timeout 等仍要报错结束。
    if (error?.kind === 'aborted') {
        finishRun(sessionId, token)
        return
    }
    attachCompactUsage({ agent, state })
    await syncHistory({ sessionId, agent }).catch(() => {})
    if (token.stopped) return
    if (activeRuns.get(sessionId) !== token) return finishRun(sessionId, token)
    await SSE.send({ id: sessionId, data: { type: 'agent-finish', error: error.message } })
    finishRun(sessionId, token)
}

// --- 发送前检查：输入、停止状态、运行状态和继续位置 ---
const validateRun = async ({ sessionId, input, resume }) => {
    if (!resume && (typeof input !== 'string' || !input.trim())) throw fail(400, 'input must be a non-empty string')
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

// --- 开跑前：保存当前历史，然后通知前端开始；resume 不追加用户消息 ---
const startAgent = ({ sessionId, agent, resume, token }) => async () => {
    await syncHistory({ sessionId, agent })
    if (token.stopped || activeRuns.get(sessionId) !== token) return
    await SSE.send({ id: sessionId, data: { type: resume ? 'agent-resume' : 'agent-start' } })
}

// --- 模型请求的开始和结束：记录耗时和用量 ---
const modelEvents = ({ sessionId, state }) => ({
    onLLMStart: request => {
        state.llmStartedAt = Date.now()
        return SSE.send({ id: sessionId, data: { type: 'llm-start', ...request } })
    },
    onLLMFinish: result => {
        const finishedAt = Date.now()
        state.pendingUsage = usageOf({ usage: result.usage, startedAt: state.llmStartedAt || finishedAt, finishedAt })
        return SSE.send({ id: sessionId, data: { type: 'llm-finish', ...result, usage: state.pendingUsage, durationMs: state.pendingUsage.durationMs } })
    },
})

// --- 原样转发给前端的事件 ---
const forwardedEvents = ({ sessionId, state }) => ({
    onLLMEvent: event => SSE.send({ id: sessionId, data: event }),
    onRetry: info => SSE.send({ id: sessionId, data: { type: 'retry', ...info } }),
    onToolCall: call => SSE.send({ id: sessionId, data: { ...call, type: 'tool-call' } }),
    onToolOutput: output => SSE.send({ id: sessionId, data: { ...output, type: 'tool-output' } }),
    onCompact: event => {
        if (event.type === 'compact-start') state.compactStartedAt = Date.now()
        if (event.type === 'compact-finish') {
            const finishedAt = Date.now()
            state.pendingCompactUsage.push(usageOf({
                usage: event.usage,
                startedAt: state.compactStartedAt || finishedAt,
                finishedAt,
            }))
        }
        return SSE.send({ id: sessionId, data: event })
    },
})

// --- 工具结果原样推给前端 ---
const sendToolResult = ({ sessionId }) => async result => {
    await SSE.send({ id: sessionId, data: { ...result, type: 'tool-result' } })
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
const startRun = async ({ sessionId, input, resume, agent }) => {
    const session = await History.load(sessionId)
    const settings = await Agent.readSettings(sessionId)
    if (stopping.has(sessionId)) throw fail(409, '正在停止上一轮任务，请稍后再试')

    const state = { llmStartedAt: 0, pendingUsage: null, compactStartedAt: 0, compactStartIndex: agent.history.length, pendingCompactUsage: [] }
    const token = { stopped: false, state }
    activeRuns.set(sessionId, token)
    let task
    try {
        const options = {
            config: Agent.resolve({ session, settings }),
            callbacks: {
                onStart: startAgent({ sessionId, agent, resume, token }),
                ...modelEvents({ sessionId, state }),
                ...forwardedEvents({ sessionId, state }),
                onToolResult: sendToolResult({ sessionId }),
                onStep: saveStep({ sessionId, agent, state }),
                onPermission: askBeforeTool({ sessionId, agent }),
            },
        }
        task = resume ? agent.resume(options) : agent.send({ ...options, input: input.trim() })
    } catch (error) {
        finishRun(sessionId, token)
        throw error
    }
    return { task, token }
}

const run = async ({ sessionId, input, resume = false }) => {
    const agent = await validateRun({ sessionId, input, resume })

    // 新消息代表新的时间线，之前的回退不能再撤销；计数也重新开始。
    await Tool.clearUndo({ sessionId })
    Approval.reset(sessionId)

    const { task, token } = await startRun({ sessionId, input, resume, agent })
    task
        .then(result => finishSuccess({ sessionId, token, agent, resume, result }))
        .catch(error => finishFailure({ sessionId, token, agent, state: token.state, error }))
    return { ok: true }
}

// --- 第一次聊完之后给会话起标题 ---
const titleFor = async ({ sessionId }) => {
    const session = await History.load(sessionId)
    if (session.title !== Title.UNTITLED) return

    // 标题用哪份连接：config.models.title，没配就和这条会话的模型共用。
    const target = Agent.configured(store.config.models?.title) || session.model
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
            finishRun(sessionId, token)
        }
        return result
    } finally {
        stopping.delete(sessionId)
    }
}

const send = ({ sessionId, input }) => run({ sessionId, input })
const resume = ({ sessionId }) => run({ sessionId, resume: true })
const decide = input => Approval.decide(input)

export default { send, resume, stop, decide }
