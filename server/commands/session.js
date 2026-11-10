/*
 * 会话指令：创建、列表、读取、分支、改名、删除、目录、设置、模型和回退。
 *
 * 会话是唯一的长期容器；cwd 只是它的一个属性，换目录不需要新建会话。
 * 消息回退由 features/rollback.js 负责；文件和预览由 tools/file.js 的快照能力负责，
 * 这一层只把两边按用户看到的顺序串起来。
 *
 * 依赖按用途分组，同一个 feature 在这里只承担一种角色：
 *   Agent    会话装配与运行状态（create/get/invalidate/readSettings/resolve）
 *   History  会话数据的唯一读写口（load/add/save/destroy）
 *   Approval / Tool / ToolTiming  删除会话时的联动清理；工具快照供回退预览
 *   Rollback / Compact / Title / SessionGroups  各自动作的纯逻辑实现
 *
 * 调用示例：
 *   const { sessionId } = await Session.create({ title: '写爬虫', cwd: 'D:/notes' })
 *   const session = await Session.read({ sessionId })
 *   await Session.dir({ sessionId, cwd: 'D:/other' })
 *   await Session.rollback({ sessionId, messageId })
 */

import { stat } from 'node:fs/promises'
import store from '../store.js'
import Agent from '../features/agent.js'
import Approval from '../features/approval.js'
import Compact from '../features/compact.js'
import Context from '../features/context.js'
import History from '../features/history.js'
import Mcp from '../features/mcp.js'
import Skills from '../features/skills.js'
import ContextUsage from '../utils/context-usage.js'
import Rollback from '../features/rollback.js'
import SessionGroups from '../features/session-groups.js'
import Tool from '../features/tool.js'
import ToolTiming from '../features/tool-timing.js'
import SSE from '../utils/sse.js'
import Path from '../utils/path.js'
import TempWorkspace from '../utils/temp-workspace.js'
import fail from '../utils/fail.js'
import usageOf from '../utils/usage.js'

// --- 工具执行前的审批关口：审批不持有工具表，工具参数由这里递给它 ---
const checkPermission = params => Approval.check({
    ...params,
    snapshot: Tool.snapshot,
    ready: Tool.ready,
    kindOf: Tool.kind,
})

// --- 装配一条会话的 Agent 要用的全部材料 ---
const agentMaterials = async sessionId => {
    const session = await History.load(sessionId)
    const saveSession = () => History.save(sessionId)
    const built = await Tool.build({ sessionId, onPermission: checkPermission, saveSession, mcp: Mcp, skills: Skills })
    return { session, settings: Agent.settings(session), ...built, onPermission: checkPermission, saveSession, context: Context }
}

// --- 取回缓存的 Agent，没有或已过期就按最新材料装配 ---
const getAgent = sessionId => Agent.get({
    sessionId,
    assemble: {
        peek: async () => ({ session: await History.load(sessionId), context: Context }),
        build: () => agentMaterials(sessionId),
        mcpRevision: () => Tool.revision(Mcp),
        getHistory: id => History.get({ sessionId: id }),
    },
})

const createAgent = async sessionId => Agent.create({ sessionId, ...await agentMaterials(sessionId) })

// --- 整理用户填的标题 ---
const cleanTitle = title => {
    if (typeof title !== 'string' || !title.trim()) throw fail(400, 'title must be a non-empty string')
    return title.trim()
}

// --- 目录必须是真实存在的文件夹 ---
const folder = async path => {
    if (typeof path !== 'string' || !path.trim()) throw fail(400, 'cwd must be a non-empty string')
    const info = await stat(path).catch(() => null)
    if (!info?.isDirectory()) throw fail(400, `Folder not found: ${path}`)
    return path
}

// --- 创建会话 ---
const create = async ({ title, cwd, provider, model }) => {
    const clean = cleanTitle(title)

    // --- 选模型：点名了就查它，没点名就用配置里的对话默认 ---
    const first = Agent.model()
    const namedProvider = typeof provider === 'string' && provider.trim() ? provider.trim() : ''
    const namedModel = typeof model === 'string' && model.trim() ? model.trim() : ''
    let chosen
    if (!namedProvider && !namedModel) {
        if (first.provider) Agent.connection(first)
        chosen = first.provider ? first : { provider: '', model: '' }
    } else {
        const name = namedProvider || first.provider
        if (!name) chosen = { provider: '', model: '' }
        else {
            const info = (store.config.providers || []).find(item => item.name === name)
            if (!info) throw fail(400, `Provider not found: ${name}`)
            const own = info.models?.[0]
            const id = namedModel || own?.id || ''
            Agent.connection({ provider: name, model: id })
            chosen = { provider: name, model: id }
        }
    }
    // 没有指定目录时用独立临时工作区，避免 agent 默认在项目代码旁边动手。
    const requested = typeof cwd === 'string' && cwd.trim() ? cwd : ''
    const temporary = !requested
    const cwdPath = requested ? await folder(requested) : await TempWorkspace.create()
    let session
    try {
        session = await History.create({
            title: clean,
            cwd: cwdPath,
            temporary,
            provider: chosen.provider,
            model: chosen.model,
            settings: Agent.defaults(),
        })
        await createAgent(session.id)
    } catch (error) {
        if (temporary) await TempWorkspace.remove(cwdPath, true).catch(() => {})
        throw error
    }
    return { sessionId: session.id }
}

// --- 从现有会话分出一个新分支 ---
// 分支只读不写：读历史快照、另建新会话，运行中也能安全进行，原会话不受影响。
const fork = async ({ sessionId, title, messageId }) => {
    const source = await History.load(sessionId)

    const messages = History.get({ sessionId })
    let kept = messages
    if (messageId) {
        const index = messages.findIndex(message => message.messageId === messageId)
        if (index < 0) throw fail(404, `Message not found: ${messageId}`)
        kept = messages.slice(0, index + 1)
    }

    const clean = typeof title === 'string' && title.trim() ? title.trim() : `${source.title}（分支）`
    // 临时工作区不能和原会话共用：分支拿到自己的一份，删任何一边都不影响另一边。
    const branchCwd = source.temporary ? await TempWorkspace.clone(source.cwd) : source.cwd
    let branch
    try {
        branch = await History.create({
            title: clean.slice(0, 120),
            cwd: branchCwd,
            temporary: source.temporary,
            provider: source.model.provider,
            model: source.model.model,
            settings: Agent.settings(source),
        })
    } catch (error) {
        if (source.temporary) await TempWorkspace.remove(branchCwd, true).catch(() => {})
        throw error
    }
    // 历史复制到新目录，消息重新编号，分支之后的操作不会影响原会话。
    for (const { messageId: oldId, ...message } of kept) await History.add({ sessionId: branch.id, message })
    await History.save(branch.id)
    await createAgent(branch.id)
    return { sessionId: branch.id }}

// --- 读取一条会话：默认返回完整历史；open 走 segmented，只给 manifest + 当前段 ---
const read = async ({ sessionId, onProgress, segmented = false, after, segment: segmentId } = {}) => {
    // segment 模式：只读一个封存段，给折叠的历史段展开用（数据结构不同，单独处理）
    if (segmentId) {
        const segment = await History.segment({ sessionId, segmentId })
        return { id: sessionId, segment: segmentId, messages: segment.messages }
    }

    // 加载历史、装配 agent、过滤内部消息：所有分支都需要
    await ContextUsage.hydrate(sessionId)
    const session = await History.load(sessionId, { onProgress })
    const agent = Agent.runtime().get(sessionId)
    const running = Boolean(agent?.running)
    const visible = history => history.filter(message => !message.internal)
    const history = running ? visible(agent.history) : visible(History.get({ sessionId }))
    if (!running && agent) agent.history = history                      // 打开会话只读历史，不在此时装配 Agent

    // 统计数据：所有分支都需要，只算一次
    const stats = {
        historyTotal: history.length,
        historyStats: historyUsage(history, session.model.provider, session.model.model),
        contextEstimate: ContextUsage.read(sessionId),
        todos: (() => {
            for (const message of [...history].reverse()) {
                for (const part of Array.isArray(message.content) ? message.content : []) {
                    if (part.type !== 'tool-result' || part.toolName !== 'update_todo_list') continue
                    if (part.output?.value?.items) return part.output.value.items
                }
            }
            return []
        })(),
        toolTimings: await ToolTiming.read(sessionId),
        pending: Approval.pending(sessionId),
        undoable: History.redos({ sessionId }),
        running,
    }

    // after 模式：增量读，只返回指定消息之后的新增内容
    if (after) {
        const afterIndex = history.findIndex(m => m.messageId === after || m.id === after)
        const delta = afterIndex >= 0 ? history.slice(afterIndex + 1) : history
        return { id: session.id, ...stats, delta, after, updatedAt: session.updatedAt }
    }

    // 正常/分段分支：全量或当前段
    const usePage = segmented === 'true' || segmented === true
    const page = usePage ? History.page({ sessionId, history }) : null
    return {
        id: session.id,
        title: session.title,
        cwd: session.cwd,
        temporary: session.temporary === true,
        provider: session.model.provider,
        model: session.model.model,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        history: page?.manifest ? page.current : history,
        ...(page?.manifest ? { historyManifest: page.manifest } : {}),
        ...stats,
        settings: Agent.settings(session),
    }
}

// --- 会话级用量聚合：统计必须基于完整历史，而不是前端最近窗口 ---
// 挡脏值：数字合法且 >= 0 就接受，没有上限（以后上下文窗口可能超过现在的数字）。
const safeTokens = value => {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0
}

function historyUsage(history, fallbackProvider = '', fallbackModel = '') {
    const requests = []
    for (const message of history) {
        if (!message || message.compact || !message.usage) continue
        const usage = message.usage
        const input = safeTokens(usage.input)
        const output = safeTokens(usage.output)
        const durationMs = Number(usage.durationMs || 0)
        const firstTokenMs = Number(usage.firstTokenMs || 0)
        const reasoning = safeTokens(usage.reasoning)
        // TPS 只看原始生成：usage.output 去掉 reasoning；分母用整次请求耗时，
        // 不再减去首字时间，否则供应商把首字和正文一起返回时会冲成几千 tok/s。
        const rawOutput = Math.max(0, output - reasoning)
        requests.push({
            input,
            output,
            cache: safeTokens(usage.cacheRead),
            cacheWrite: safeTokens(usage.cacheWrite),
            reasoning,
            total: safeTokens(usage.total) || input + output,
            provider: usage.provider || fallbackProvider,
            model: usage.model || fallbackModel,
            startedAt: Number(usage.startedAt || 0),
            finishedAt: Number(usage.finishedAt || 0),
            firstTokenMs,
            durationMs,
            tps: durationMs > 0 ? rawOutput / (durationMs / 1000) : 0,
        })
    }

    let input = 0
    let output = 0
    let total = 0
    let cacheRead = 0
    let cacheWrite = 0
    let reasoning = 0
    let durationMs = 0
    const groups = new Map()
    for (const item of requests) {
        input += item.input
        output += item.output
        total += item.total
        cacheRead += item.cache
        cacheWrite += item.cacheWrite
        reasoning += item.reasoning
        durationMs += item.durationMs
        const key = `${item.provider}\u0000${item.model}`
        const group = groups.get(key) || {
            provider: item.provider, model: item.model, count: 0, output: 0,
            durationMs: 0, durationCount: 0, generationMs: 0,
            firstTokenMs: 0, firstTokenCount: 0, lastFirstTokenMs: 0,
            lastTps: 0, lastAt: 0, latest: null,
        }
        group.count += 1
        group.output += Math.max(0, item.output - item.reasoning)
        if (item.durationMs > 0) {
            group.durationMs += item.durationMs
            group.durationCount += 1
            group.generationMs += item.durationMs
        }
        if (item.firstTokenMs > 0) {
            group.firstTokenMs += item.firstTokenMs
            group.firstTokenCount += 1
            group.lastFirstTokenMs = item.firstTokenMs
        }
        if (item.tps > 0) group.lastTps = item.tps
        if (item.firstTokenMs > 0 || item.durationMs > 0) {
            group.latest = {
                firstTokenMs: item.firstTokenMs,
                durationMs: item.durationMs,
                tps: item.tps,
                at: item.finishedAt || item.startedAt || 0,
            }
            group.lastAt = group.latest.at
        }
        groups.set(key, group)
    }

    const models = [...groups.values()].map(group => ({
        provider: group.provider || '未知供应商',
        model: group.model || '未知模型',
        count: group.count,
        averageFirstTokenMs: group.firstTokenCount ? group.firstTokenMs / group.firstTokenCount : 0,
        averageDurationMs: group.durationCount ? group.durationMs / group.durationCount : 0,
        averageTps: group.generationMs ? group.output / (group.generationMs / 1000) : 0,
        lastFirstTokenMs: group.latest?.firstTokenMs || group.lastFirstTokenMs || 0,
        lastDurationMs: group.latest?.durationMs || 0,
        lastTps: group.latest?.tps || group.lastTps || 0,
        lastAt: group.lastAt || 0,
        latest: group.latest,
    }))

    return {
        input, output, total, cacheRead, cacheWrite, reasoning, durationMs,
        requests: requests.length,
        models,
        series: requests.slice(-18).map(item => ({ input: item.input, output: item.output, cache: item.cache })),
    }
}

// --- 重命名 ---
const rename = async ({ sessionId, title }) => {
    const session = await History.load(sessionId)
    session.title = cleanTitle(title)
    session.updatedAt = Date.now()
    await History.save(sessionId)
    return { ...session, provider: session.model.provider, model: session.model.model }
}

// --- 换模型 ---
const model = async ({ sessionId, provider, model: modelId }) => {
    const session = await History.load(sessionId)
    const chosen = typeof provider === 'string' && provider.trim() ? provider.trim() : session.model.provider
    const name = typeof modelId === 'string' && modelId.trim() ? modelId.trim() : session.model.model
    if (!chosen || !name) throw fail(400, 'provider and model must be non-empty strings')
    Agent.connection({ provider: chosen, model: name })

    session.model = { provider: chosen, model: name }
    session.updatedAt = Date.now()
    await History.save(sessionId)

    const agent = Agent.runtime().get(sessionId)
    if (agent?.running) {
        // core 0.30 每轮现读 agent.config；运行中只换配置，不重建实例、不中断当前任务。
        const agentSettings = Agent.settings(session)
        Object.assign(agent.config, await Agent.resolve({ session, settings: agentSettings, target: { provider: chosen, model: name }, context: Context }))
    } else {
        Agent.invalidate(sessionId)
        await createAgent(sessionId)
    }
    return { ...session, provider: chosen, model: name }
}

// --- 换目录 ---
const dir = async ({ sessionId, cwd }) => {
    const session = await History.load(sessionId)
    const previous = session.cwd
    const wasTemporary = session.temporary === true
    session.cwd = await folder(cwd)
    session.temporary = false
    session.updatedAt = Date.now()
    await History.save(sessionId)
    if (wasTemporary && !Path.samePath(previous, session.cwd)) await TempWorkspace.remove(previous, true).catch(() => {})
    return { id: session.id, cwd: session.cwd, temporary: false }
}

// --- 删除会话 ---
const remove = async ({ sessionId }) => {
    const session = await History.load(sessionId)
    if (Agent.runtime().get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)

    Agent.invalidate(sessionId)
    Approval.remove(sessionId)
    await Tool.remove({ sessionId })
    await SSE.close({ id: sessionId })
    await History.destroy(sessionId)
    if (session.temporary) await TempWorkspace.remove(session.cwd, true).catch(error => console.error(`[session ${sessionId}] 清理临时工作区失败：${error.message}`))
    await SessionGroups.remove(sessionId).catch(error => console.error(`[session ${sessionId}] 清理分组失败：${error.message}`))
    ToolTiming.forget(sessionId)
    ContextUsage.remove(sessionId)
    return { ok: true }
}

// --- 会话级设置快照：思考强度、模型、当前目录放一起 ---
// 这三个都是“这条会话自己的”设置，读写都走同一个结构，前端只认一份。
const settings = async ({ sessionId }) => {
    const session = await History.load(sessionId)
    const settings = Agent.settings(session)
    return {
        reasoning: settings.reasoning,
        provider: session.model.provider,
        model: session.model.model,
        cwd: session.cwd,
        temporary: session.temporary === true,
    }
}

// --- 改会话级设置：点名哪几项就改哪几项，最后回一份快照 ---
const patch = async ({ sessionId, reasoning, provider, model: modelName, cwd }) => {
    // --- 改思考强度：读历史、归一、写回、必要时重建 Agent ---
    if (reasoning !== undefined) {
        const session = await History.load(sessionId)
        const current = Agent.normalize(session.settings, Agent.defaults())
        const saved = Agent.normalize({ reasoning }, current)
        await History.settings({ sessionId, settings: saved })
        if (reasoning !== current.reasoning) {
            const agent = Agent.runtime().get(sessionId)
            if (agent?.running) {
                Object.assign(agent.config, await Agent.resolve({ session, settings: saved, context: Context }))
            } else {
                Agent.invalidate(sessionId)
                await createAgent(sessionId)
            }
        }
    }
    if (provider !== undefined || modelName !== undefined) await model({ sessionId, provider, model: modelName })
    if (cwd !== undefined) await dir({ sessionId, cwd })
    return settings({ sessionId })
}

// --- 手动压缩 ---
const compact = async ({ sessionId }) => {
    const agent = await getAgent(sessionId)                         // 已经装配好的 agent
    const start = agent.history.length                                  // 压缩前的位置
    let compactStartedAt = 0
    let compactUsage
    const content = await Compact.run({
        sessionId,
        agent,
        onEvent: event => {
            if (event.type === 'compact-start') compactStartedAt = Date.now()
            if (event.type === 'compact-finish') {
                const finishedAt = Date.now()
                compactUsage = usageOf({
                    usage: event.usage,
                    startedAt: compactStartedAt || finishedAt,
                    finishedAt,
                })
            }
            return SSE.send({ id: sessionId, data: event })
        },
    })
    for (const message of agent.history.slice(start)) {
        if (message.compact && compactUsage) message.usage = compactUsage
        await History.add({ sessionId, message }) // 只保存新追加的总结
    }
    await History.save(sessionId)
    return { ...await read({ sessionId }), content }
}

// --- 回退：给 messageId 退对话（可连文件），给 toolCallId 只退那次工具改的文件 ---
// 三种回退模式：消息级（整条对话）、正文块级（一条消息里的某个块）、工具调用级（只退文件）。
// 两个都给的时候不猜，直接报错——猜错会把用户不想退的对话退掉。
const rollback = async (params) => {
    const { sessionId, messageId, toolCallId, partIndex, files = true, compact = false } = params

    // 参数校验：三种模式互斥
    if (messageId && toolCallId) throw fail(400, 'give messageId or toolCallId, not both')
    if (!messageId && !toolCallId) throw fail(400, 'messageId or toolCallId is required')
    if (partIndex !== undefined && toolCallId) throw fail(400, 'partIndex only works with messageId')

    // 分派到三种模式
    if (partIndex !== undefined) return rollbackPart({ sessionId, messageId, partIndex, files, compact })
    if (toolCallId) return rollbackToolCall({ sessionId, toolCallId, files })
    return rollbackMessage({ sessionId, messageId, files, compact })
}

// --- 正文块/工具调用级回退：同一条 assistant 消息只保留目标之前的内容 ---
const rollbackPart = async ({ sessionId, messageId, partIndex, files, compact }) => {
    await History.load(sessionId)                                        // 加载历史到内存
    if (Agent.runtime().get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`) // 运行中不能回退
    const plan = Rollback.plan({ history: History, sessionId, messageId, partIndex }) // 算出回退后还留哪些消息块
    const restored = files
        ? await Tool.restore({ sessionId, keepMessages: plan.keepMessages, dropToolCalls: plan.dropToolCalls })
        : []                                                             // files=false 时不恢复文件，只退消息
    await Rollback.cut({ history: History, agent: Agent, sessionId, messageId, partIndex }) // 执行回退
    return compact ? compactRollback(sessionId, restored) : { ...await read({ sessionId }), restored }
}

// --- 工具调用级回退：只退某一次工具改的文件，对话不动 ---
const rollbackToolCall = async ({ sessionId, toolCallId, files }) => {
    await History.load(sessionId)
    if (Agent.runtime().get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)
    const restored = files
        ? await Tool.restore({ sessionId, toolCallId })              // 恢复这次工具调用改的文件
        : await Tool.drop({ sessionId, toolCallId })                 // 只清快照，不恢复
    return { ...await read({ sessionId }), restored }                    // 这条路径一直返回完整结果，compact 不生效，接口行为保持原样
}

// --- 消息级回退：退到某条消息之前，可连文件一起退 ---
const rollbackMessage = async ({ sessionId, messageId, files, compact }) => {
    await History.load(sessionId)
    if (Agent.runtime().get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)
    const plan = Rollback.preview({ history: History, sessionId, messageId }) // 算出回退后还留哪些消息块
    const restored = files ? await Tool.restore({ sessionId, keepMessages: plan.keep, dropToolCalls: plan.toolCalls }) : []
    await Rollback.messages({ history: History, agent: Agent, sessionId, messageId }) // 执行回退
    return compact ? compactRollback(sessionId, restored) : { ...await read({ sessionId }), restored }
}

// --- 回退/撤销的紧凑响应：前端已经知道目标，不需要再拿 12k 条历史 ---
const compactRollback = async (sessionId, restored) => {
    const session = await History.load(sessionId)
    return {
        id: sessionId,
        historyTotal: session.history.messages.length,
        undoable: History.redos({ sessionId }),
        restored,
    }
}

// --- 撤销最近一次回退 ---
const redo = async ({ sessionId, files = true, compact = false }) => {
    await History.load(sessionId)
    if (Agent.runtime().get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)

    const restored = files ? await Tool.undo({ sessionId }) : []
    await Rollback.undo({ history: History, agent: Agent, sessionId })
    return compact ? compactRollback(sessionId, restored) : { ...await read({ sessionId }), restored }
}

// --- 列表与统计 ---
// 分组只是显示顺序，跟列表一起返回，不再单开一条接口。
const list = async ({ search } = {}) => ({
    sessions: await History.list({ search }),
    groups: (await SessionGroups.read()).groups || [],
})

// --- 统计会话数量 ---
const count = () => History.count()

// --- 统计正在运行的任务 ---
const running = () => Agent.count()

export default {
    create, fork, list, read, rename, model, dir, remove,
    settings, patch, compact,
    rollback, redo,
    count, running,
}
