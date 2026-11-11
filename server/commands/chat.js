/*
 * 对话指令：发送、继续、停止和审批决定。
 *
 * 一次运行的编排都在这里：启动 Agent、把过程推成 SSE、保存新消息、收尾。
 * 模型请求和工具循环由 @kernel4632/agent-core 负责；本文件只 import features 和 utils，
 * 不 import 别的命令文件。Agent 的装配（取齐历史、工具、审批、上下文）写在本文件里。
 *
 * 调用示例：
 *   await Chat.send({ sessionId, input: '你好' })
 *   await Chat.send({ sessionId, input: [{ type: 'text', text: '看这张图' }, { type: 'image', image: 'data:image/png;base64,...' }] })
 *   await Chat.resume({ sessionId })
 *   await Chat.stop({ sessionId })
 *   await Chat.decide({ sessionId, toolCallId, decision: 'allow' })
 */

import { nanoid } from 'nanoid'
import Agent from '../features/agent.js'
import Approval from '../features/approval.js'
import Context from '../features/context.js'
import History from '../features/history.js'
import Mcp from '../features/mcp.js'
import Title from '../features/title.js'
import Tool from '../features/tool.js'
import ToolTiming from '../features/tool-timing.js'
import SSE from '../utils/sse.js'
import fail from '../utils/fail.js'
import usageOf from '../utils/usage.js'
import ContextUsage from '../utils/context-usage.js'
import ContextRatios from '../utils/context-ratios.js'

// --- 工具执行前的审批关口：审批不持有工具表，工具参数由这里递给它 ---
const checkPermission = params => Approval.check({
    ...params,
    snapshot: Tool.snapshot,
    ready: Tool.ready,
    kindOf: Tool.kind,
})

// --- 取回缓存的 Agent，没有或已过期就按最新材料装配 ---
// assemble 是 Agent.get 用的取材入口：peek 只读元数据判断缓存能不能用，
// build 真正取齐材料；mcpRevision 判断是否过期，getHistory 补新消息。
const getAgent = sessionId => Agent.get({
    sessionId,
    assemble: {
        peek: async () => ({ session: await History.load(sessionId), context: Context }),
        build: async () => {
            const session = await History.load(sessionId)
            const saveSession = () => History.save(sessionId)
            const built = await Tool.build({ sessionId, onPermission: checkPermission, saveSession, mcp: Mcp })  // skills 由扩展注入
            return { session, settings: Agent.settings(session), ...built, onPermission: checkPermission, saveSession, context: Context }
        },
        mcpRevision: () => Tool.revision(Mcp),
        getHistory: id => History.get({ sessionId: id }),
    },
})

// 一个会话的运行状态：用一个状态机代替两个独立的 Map/Set，避免竞态窗口。
// status 可能的值：running（运行中） | stopping（停止中）。idle/starting 未使用，仅供理解状态机。
// token 是这一轮的标记，只有持有当前 token 的请求才能发终态；旧 token 失效后直接丢弃。
const sessions = new Map()  // sessionId -> { status, token, agent }
const saveQueue = new Map() // sessionId -> 上一次保存的 Promise（串成队列）

// --- 一轮结束：清运行标记 ---
// 必须 await 落盘：不能留后台 Promise。测试切 AGENT_HOME、进程正在退出、
// 或用户马上又发下一句时，悬着的写入会落到错误的目录或晚到而覆盖新状态。
const finishRun = async (sessionId, token) => {
    const state = sessions.get(sessionId)
    if (state?.token !== token) return                                  // token 已失效，不再处理
    sessions.delete(sessionId)                                           // 清除运行状态
    // 无论本轮是成功还是失败，都把磁盘上的运行标记清掉：下次重启时不再把已结束的会话当作被打断。
    History.running(sessionId, false)
    await History.mark(sessionId).catch(error => console.error(`[session ${sessionId}] 清除运行标记失败：${error.message}`))
    await Agent.settle(sessionId, Tool.revision(Mcp))
}

// --- 把 Agent 内存里的新消息同步到历史文件 ---
// 串成队列：上一笔没写完时，这一笔等它写完再拍快照，避免覆盖中间状态。
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

// 压缩用量记在本轮追加的 compact 项，不覆盖旧总结或普通回答。
const attachCompactUsage = ({ agent, state }) => {
    if (!state?.pendingCompactUsage) return
    for (const message of agent.history.slice(state.compactStartIndex)) {
        if (!message.compact || message.usage) continue
        const usage = state.pendingCompactUsage.shift()
        if (usage) message.usage = usage
    }
}

// 真实 usage 学到的上下文比例写进宿主缓存；host/default 不覆盖已学样本。
const rememberRatio = state => {
    const info = state.agent?.getContextRatio?.()
    if (info?.source !== 'usage') return
    void ContextRatios.remember({
        provider: state.agent?.config?.providerName || '',
        model: state.agent?.config?.model || '',
        ratio: info.ratio,
        source: info.source,
    })
}

// 继续时的末尾判断：找最后一条非工具、非内部的对话消息。
const lastConversationMessage = history => [...history]
    .reverse()
    .find(message => !message.internal && message.role !== 'tool')

// --- 输入校验用到的常量 ---
// 图片只认 data URL 和 http(s) URL；base64 上限 8M 字符（约 6 MB 原图），防止一次请求撑爆上下文。
const IMAGE_SOURCE = /^(data:image\/(?:png|jpe?g|gif|webp);base64,|https?:\/\/)/
const MAX_IMAGE_CHARS = 8 * 1024 * 1024

// 末尾是用户消息时说明上一请求在模型返回前被打断，用一条内部续跑提示再发一次
// （不写进历史，也不在界面上多出用户气泡）。
const RESUME_USER_PROMPT = '[System notice] The previous user request was interrupted before the assistant replied. Continue that request now. Do not ask for confirmation, do not repeat completed work, and do not mention this notice.'

// 上下文余量提醒：距压缩点只剩 5% 预算时，往下一笔请求临时插一句，让模型收口。
// 阈值从 compact.threshold 推导，用户调低压缩阈值时提醒点自动跟着挪，两套阈值永不脱钩。
const CONTEXT_MARGIN = 0.05
const CONTEXT_REMINDER = '[System reminder] The context is close to the compaction threshold. Wrap up cleanly: finish the current step, call attempt_completion with a complete handover (or update the todo list with the next concrete step and the key file paths), so the conversation can be summarized without losing your place. Do not start large new work this turn.'

// --- 启动一轮对话：落盘运行标记、组装 agent-core 回调、发出请求 ---
// 回调由 run 和 recover 共用；成功失败收尾都在 run 里接住。
const startRun = async ({ sessionId, input, resume, agent, recovery = false }) => {
    // --- 读会话和设置，再次检查停止状态 ---
    const session = await History.load(sessionId)
    const settings = Agent.settings(session)
    if (sessions.get(sessionId)?.status === 'stopping') throw fail(409, '正在停止上一轮任务，请稍后再试')

    // --- 落盘"运行中"标记 ---
    // await：标记必须在模型请求之前真的落到磁盘，否则进程刚好在写入前被杀死就没有线索。
    History.running(sessionId, true)
    await History.mark(sessionId).catch(error => console.error(`[session ${sessionId}] 保存运行标记失败：${error.message}`))

    // --- 组装运行状态和 token ---
    const runState = { agent, llmStartedAt: 0, firstTokenAt: 0, contentStartedAt: 0, lastContentAt: 0, requesting: false, pendingUsage: null, compactStartedAt: 0, compactStartIndex: agent.history.length, pendingCompactUsage: [], compactReminded: false }
    const token = { stopped: false, state: runState }
    sessions.set(sessionId, { status: 'running', token, agent })

    // --- 组装 agent-core 回调 ---
    const options = {
        config: await Agent.resolve({ session, settings, recovery, context: Context }),
        callbacks: {
            // 开跑前：通知前端开始；历史落盘异步跑，不挡在模型请求之前
            onStart: async () => {
                if (token.stopped || sessions.get(sessionId)?.token !== token) return
                await SSE.send({ id: sessionId, data: { type: resume ? 'agent-resume' : 'agent-start' } })
                syncHistory({ sessionId, agent }).catch(error => console.error(`[session ${sessionId}] 启动时保存历史失败：${error.message}`))
            },

            // 每轮请求前：记录用量、判断要不要插上下文提醒
            onInject: ({ tokens, budget, compactThreshold, ratio, ratioSource }) => {
                ContextUsage.record(sessionId, { tokens, budget, compactThreshold })
                if (ratioSource === 'usage') {
                    void ContextRatios.remember({
                        provider: agent?.config?.providerName || '',
                        model: agent?.config?.model || '',
                        ratio,
                        source: ratioSource,
                    })
                }
                if (runState.compactReminded) return ''                    // 这个 run 已经提醒过，不重复
                if (!Number.isFinite(budget)) return ''                     // 没有预算就没有压缩，不提醒
                const compactPoint = budget * compactThreshold
                if (tokens < compactPoint - budget * CONTEXT_MARGIN) return '' // 还没到提醒带
                runState.compactReminded = true
                return CONTEXT_REMINDER
            },

            // 模型请求开始和结束：记录首字时间、总耗时和用量
            onLLMStart: request => {
                if (runState.requesting) return                              // 重试沿用原来的开始时间，同一请求只开一行
                runState.requesting = true
                runState.llmStartedAt = Date.now()
                runState.firstTokenAt = 0
                runState.contentStartedAt = 0
                runState.lastContentAt = 0
                // 每轮现读 config：运行中切模型后，这一笔就按新供应商/模型记录。
                runState.provider = agent?.config?.providerName || ''
                runState.model = agent?.config?.model || ''
                // request.messages 是这次发给模型的完整上下文（可能几十万 token）；
                // 界面只需要"请求开始了"，把这份副本塞进 SSE 会白等一次巨大序列化和 JSON.parse。
                const { messages: _messages, ...meta } = request || {}
                return SSE.send({
                    id: sessionId,
                    data: { type: 'llm-start', ...meta, startedAt: runState.llmStartedAt, provider: runState.provider, model: runState.model },
                })
            },
            onLLMFinish: result => {
                runState.requesting = false
                const finishedAt = Date.now()
                // usage 刚回来时 core 已经完成这一笔的校准；这里补记，避免最后一笔没有下一轮 onInject。
                rememberRatio(runState)
                runState.pendingUsage = usageOf({
                    usage: result.usage,
                    startedAt: runState.llmStartedAt || finishedAt,
                    finishedAt,
                    firstTokenAt: runState.firstTokenAt,
                    generationMs: runState.contentStartedAt && runState.lastContentAt
                        ? Math.max(0, runState.lastContentAt - runState.contentStartedAt)
                        : 0,
                    provider: runState.provider,
                    model: runState.model,
                })
                return SSE.send({
                    id: sessionId,
                    data: { type: 'llm-finish', ...result, usage: runState.pendingUsage, durationMs: runState.pendingUsage.durationMs },
                })
            },

            // 原样转发给前端的事件
            onLLMEvent: event => {
                // 流内部的 error 帧不转发：它只是供应商收尾时的噪音，真正的失败由循环 throw 统一变成 agent-finish 的错误终态。
                if (event?.type === 'error') return
                // 第一次收到内容增量时记下首字时间
                const isContent = event?.type?.endsWith('-delta') || event?.type === 'tool-call' || event?.type?.startsWith('tool-input')
                const isVisible = event?.type === 'text-delta' || event?.type === 'tool-call' || event?.type?.startsWith('tool-input')
                if (isVisible) {
                    const now = Date.now()
                    if (!runState.contentStartedAt) runState.contentStartedAt = now
                    runState.lastContentAt = now
                }
                if (!runState.firstTokenAt && isContent) {
                    runState.firstTokenAt = Date.now()
                    SSE.send({ id: sessionId, data: { type: 'llm-first-token', firstTokenAt: runState.firstTokenAt, firstTokenMs: Math.max(0, runState.firstTokenAt - (runState.llmStartedAt || runState.firstTokenAt)) } })
                }
                return SSE.send({ id: sessionId, data: event })
            },
            onRetry: info => {
                const error = info?.error
                // Error 对象直接 spread 会变成空对象；单独取出可读文本给前端展示。
                const errorText = error?.message || error?.responseBody || error?.body || (typeof error === 'string' ? error : '')
                return SSE.send({
                    id: sessionId,
                    data: { type: 'retry', attempt: info?.attempt, delay: info?.delay, error: errorText, statusCode: error?.statusCode, kind: error?.kind },
                })
            },
            onToolCall: async call => {
                const startedAt = Date.now()
                if (!runState.contentStartedAt) runState.contentStartedAt = startedAt
                runState.lastContentAt = startedAt
                const toolCallId = call.toolCallId || call.callID || call.callId || call.id
                await ToolTiming.start({ sessionId, toolCallId, at: startedAt }).catch(() => {})
                return SSE.send({ id: sessionId, data: { ...call, type: 'tool-call', startedAt } })
            },
            onToolOutput: output => SSE.send({ id: sessionId, data: { ...output, type: 'tool-output' } }),
            onCompact: event => {
                const data = { ...event }
                if (event.type === 'compact-start') {
                    runState.compactStartedAt = Date.now()
                    data.startedAt = runState.compactStartedAt
                    // 把"为什么压"与触发口径一起留在服务日志里，方便排查估算误判。
                    console.log(`[compact ${sessionId}] reason=${event.reason || 'unknown'} token=${event.token ?? '?'} budget=${event.budget ?? '?'} threshold=${event.compactThreshold ?? '?'} ratio=${event.ratio ?? '?'} ratioSource=${event.ratioSource ?? '?'} chars=${event.chars ?? '?'} media=${event.media ?? '?'} calibrated=${event.calibrated ?? '?'}`)
                }
                if (event.type === 'compact-finish') {
                    const finishedAt = Date.now()
                    const usage = usageOf({ usage: event.usage, startedAt: runState.compactStartedAt || finishedAt, finishedAt })
                    runState.pendingCompactUsage.push(usage)
                    data.usage = usage                       // 统一成界面字段，和 llm-finish 一样
                    data.durationMs = usage.durationMs
                }
                return SSE.send({ id: sessionId, data })
            },

            // 工具结果：记时长、补已执行时间、推改动文件
            onToolResult: async result => {
                const finishedAt = Date.now()
                const toolCallId = result.toolCallId || result.callID || result.callId || result.id
                const timing = await ToolTiming.finish({ sessionId, toolCallId, at: finishedAt }).catch(() => null)
                // 用户主动停止时 core 只返回一句"工具执行已中断"；补上已经跑的时间，让模型和界面都知道实际执行了多久。
                const output = result?.output
                if (output?.type === 'error-text' && timing) {
                    const text = String(output.value || '')
                    if (/工具执行已(中断|取消)/.test(text) && !/已执行/.test(text)) {
                        const elapsed = `${Math.max(0, Math.round((Number(timing.durationMs) || 0) / 1000))}s`
                        output.value = `${text}（已执行 ${elapsed}）`
                    }
                }
                // 这次调用改过哪些文件跟着结果一起推：前端不再需要单独的改动查询接口。
                const changedPaths = await Tool.paths({ sessionId, toolCallId }).catch(() => [])
                await SSE.send({
                    id: sessionId,
                    data: { ...result, type: 'tool-result', ...(timing || {}), ...(changedPaths.length ? { changedPaths } : {}) },
                })
            },

            // 每完成一步就落盘
            onStep: () => {
                attachCompactUsage({ agent, state: runState })
                // 把用量挂到刚追加的那条没有 usage 的助手消息上
                if (runState.pendingUsage) {
                    const message = [...agent.history].reverse().find(item => item.role === 'assistant' && !item.compact && !item.usage)
                    if (message) message.usage = runState.pendingUsage
                    runState.pendingUsage = null
                }
                return syncHistory({ sessionId, agent }).catch(error => {
                    console.error(`[session ${sessionId}] 步骤保存失败：${error.message}`)
                })
            },

            // 工具执行前的审批关口：留下"哪条用户消息"和"哪次工具调用"
            onPermission: ({ toolCallId, toolName, input, signal }) => checkPermission({
                sessionId,
                messageId: agent.history.findLast(message => message.role === 'user' && !message.internal)?.id,
                toolCallId,
                toolName,
                input,
                signal,
            }),
        },
    }

    // --- 发出请求 ---
    let task
    try {
        const last = lastConversationMessage(agent.history)
        const resumeUser = resume && last?.role === 'user'
        if (resumeUser) {
            // 末尾还没有助手内容，core 的 resume 不接受；补一条内部续跑消息重新请求。
            const before = agent.history.length
            task = agent.send({ ...options, input: RESUME_USER_PROMPT })
            const addedUser = agent.history.slice(before).find(message => message.role === 'user')
            if (addedUser) addedUser.internal = true
        } else {
            task = resume ? agent.resume(options) : agent.send({ ...options, input })
        }
    } catch (error) {
        await finishRun(sessionId, token)
        throw error
    }
    return { task, token }
}

// --- 发送或继续：校验输入、取 Agent、启动一轮、接住成功和失败 ---
const run = async ({ sessionId, input, resume = false, recovery = false }) => {
    // --- 校验输入 ---
    if (!resume) {
        const hasText = typeof input === 'string'
            ? Boolean(input.trim())
            : (Array.isArray(input) && input.filter(part => part?.type === 'text').map(part => part.text || '').join('\n').trim().length > 0)
        if (!hasText) throw fail(400, 'input must be a non-empty string')
    }
    if (sessions.get(sessionId)?.status === 'stopping') throw fail(409, '正在停止上一轮任务，请稍后再试')

    // --- 加载历史、取 Agent、再次检查停止状态 ---
    await History.load(sessionId)
    const agent = await getAgent(sessionId)
    if (sessions.get(sessionId)?.status === 'stopping') throw fail(409, '正在停止上一轮任务，请稍后再试')
    if (agent.running) throw fail(409, `Agent is already running: ${sessionId}`)

    // --- 校验续跑位置 ---
    if (resume) {
        const last = lastConversationMessage(agent.history)
        if (!last || (last.role !== 'assistant' && last.role !== 'user')) {
            throw fail(409, '最后一条消息不是用户或助手回复，不能继续')
        }
    }

    // --- 归一化输入：纯文本原样；内容块数组校验后原样交给 core ---
    const payload = resume ? undefined : (() => {
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
    })()

    // --- 新消息代表新的时间线，之前的回退不能再撤销 ---
    await Tool.clear({ sessionId })

    // --- 启动这一轮 ---
    const { task, token } = await startRun({ sessionId, input: payload, resume, agent, recovery })

    // --- 成功收尾：保存历史、起标题、通知前端 ---
    task.then(async result => {
        if (token.stopped) return
        const state = sessions.get(sessionId)
        if (state?.token !== token) return finishRun(sessionId, token)
        await syncHistory({ sessionId, agent })
        if (token.stopped) return
        if (sessions.get(sessionId)?.token !== token) return finishRun(sessionId, token)

        // 第一次聊完之后给会话起标题：标题在任务成功之后才起，跑不通就不花这次请求
        if (!resume) {
            const session = await History.load(sessionId)
            if (session.title === Title.UNTITLED) {
                const target = Agent.model('title', session.model)
                const messages = History.get({ sessionId }).filter(message => !message.internal)
                const title = await Title.generate({ connection: Agent.connection(target), messages })
                const final = title || Title.fallback(messages)
                if (final) {
                    session.title = final
                    session.updatedAt = Date.now()
                    await History.save(sessionId)
                    await SSE.send({ id: sessionId, data: { type: 'title', title: final } })
                }
            }
        }

        if (token.stopped) return
        if (sessions.get(sessionId)?.token !== token) return finishRun(sessionId, token)
        await SSE.send({ id: sessionId, data: { type: 'agent-finish', ...result } })
        await finishRun(sessionId, token)
    })

    // --- 失败收尾：保留已产生的进度，再把错误交给前端 ---
    .catch(async error => {
        if (token.stopped) return
        const status = sessions.get(sessionId)
        if (status?.token !== token) return finishRun(sessionId, token)
        // 只有 kind=aborted 才是 core 的主动取消；timeout 等仍要报错结束。
        if (error?.kind === 'aborted') {
            await finishRun(sessionId, token)
            return
        }
        attachCompactUsage({ agent, state: token.state })
        // 失败请求本身也写进历史；agent-core 0.36+ 在构造上下文时会跳过 role:'error'。
        const failedAt = Date.now()
        agent.history.push(Agent.historyError({
            content: error.message || String(error),
            request: {
                provider: token.state.provider || agent.config?.providerName || '',
                model: token.state.model || agent.config?.model || '',
                startedAt: token.state.llmStartedAt || failedAt,
                finishedAt: failedAt,
                durationMs: Math.max(0, failedAt - (token.state.llmStartedAt || failedAt)),
                error: error.message || String(error),
                kind: error.kind || 'unknown',
            },
        }))
        await syncHistory({ sessionId, agent }).catch(() => {})
        if (token.stopped) return
        if (sessions.get(sessionId)?.token !== token) return finishRun(sessionId, token)
        await SSE.send({ id: sessionId, data: { type: 'agent-finish', error: error.message } })
        await finishRun(sessionId, token)
    })

    return { ok: true }
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
    // --- 找到磁盘上标记为"运行中"的会话 ---
    const candidates = await History.stale()
    const recovered = []
    for (const { id } of candidates) {
        try {
            await History.load(id)
            const agent = await getAgent(id)
            if (agent.running) continue

            // --- 过滤不需要恢复的 ---
            const visible = History.get({ sessionId: id }).filter(message => !message.internal)
            // 磁盘上的标记说"当时正在运行"，但任务其实已经正常收尾（结束工具的结果夹在尾部 tool 段）
            let skip = false
            for (let index = visible.length - 1; index >= 0 && visible[index].role === 'tool'; index -= 1) {
                if ((visible[index].content || []).some(part => part?.type === 'tool-result' && (part.toolName === 'attempt_completion' || part.toolName === 'ask_followup_question'))) {
                    skip = true
                    break
                }
            }
            // 末尾悬着一条没有结果的工具调用也能继续：core 在每次请求前会摘掉没拿到结果的 tool-call
            const last = [...visible].reverse().find(message => !message.internal && message.role !== 'tool')
            const canResume = last?.role === 'assistant'
            if (skip || !canResume) {
                History.running(id, false)
                await History.mark(id)
                continue
            }

            // --- 逐条续跑 ---
            await run({ sessionId: id, resume: true, recovery: true })
            recovered.push(id)
        } catch (error) {
            // 一条会话恢复失败不该拖垮服务启动，也不该让它永远卡在"运行中"：清掉标记，下轮再说。
            console.error(`[recovery] 会话 ${id} 自动续跑失败：${error.message}`)
            History.running(id, false)
            await History.mark(id).catch(() => {})
        }
    }
    return { recovered }
}

// --- 停止：标记 stopping、停 agent-core、保存半段内容和历史、收尾 ---
const stop = async ({ sessionId, partial }) => {
    if (partial != null && (typeof partial !== 'object' || Array.isArray(partial))) {
        throw fail(400, 'partial must be an object')
    }

    // --- 标记停止中 ---
    const agent = Agent.runtime().get(sessionId)
    if (!agent) return { ok: false }
    const state = sessions.get(sessionId)
    if (state?.status === 'stopping') return { ok: false }              // 已经在停止中，不重复处理
    sessions.set(sessionId, { ...state, status: 'stopping' })

    try {
        const token = state?.token
        const wasRunning = Boolean(agent.running)
        if (token && wasRunning) token.stopped = true                   // 标记 token 停止

        // --- 停止 agent-core ---
        const result = await agent.stop()
        if (sessions.get(sessionId)?.token !== token) return result     // token 已失效

        // --- 保存半段回复和压缩用量 ---
        if (result.ok) {
            attachCompactUsage({ agent, state: token?.state })
            if (partial) {
                const content = typeof partial.content === 'string' ? partial.content.trim() : ''
                const reasoning = typeof partial.reasoning === 'string' ? partial.reasoning.trim() : ''
                if (content || reasoning) {
                    const last = agent.history.at(-1)
                    // 避免重复追加：最后一条已经是助手消息且包含同样的文本
                    const lastText = typeof last?.content === 'string' ? last.content
                        : (Array.isArray(last?.content) ? last.content.filter(p => p?.type === 'text').map(p => p.text || '').join('') : '')
                    if (!(last?.role === 'assistant' && content && lastText.includes(content))) {
                        agent.history.push({
                            id: nanoid(),
                            role: 'assistant',
                            content: [
                                ...(reasoning ? [{ type: 'reasoning', text: reasoning }] : []),
                                ...(content ? [{ type: 'text', text: content }] : []),
                            ],
                        })
                    }
                }
            }
        }

        // --- 保存历史 ---
        try {
            await syncHistory({ sessionId, agent })
        } catch {
            // stop 的接口约定只有 { ok }，保存失败已经写进日志。
        }

        // --- 通知前端并收尾 ---
        if (token && wasRunning && sessions.get(sessionId)?.token === token) {
            await SSE.send({ id: sessionId, data: { type: 'agent-finish', reason: 'stopped' } })
            await finishRun(sessionId, token)
        }
        return result
    } finally {
        const current = sessions.get(sessionId)
        if (current?.status === 'stopping') sessions.delete(sessionId)  // 清除停止标记
    }
}

const send = ({ sessionId, input }) => run({ sessionId, input })
const resume = ({ sessionId }) => run({ sessionId, resume: true })
const decide = input => Approval.decide(input)

export default { send, resume, stop, decide, recover }
