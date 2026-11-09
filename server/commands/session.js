/*
 * 会话指令：创建、列表、读取、分支、改名、删除、目录、设置、模型和回退。
 *
 * 会话是唯一的长期容器；cwd 只是它的一个属性，换目录不需要新建会话。
 * 消息回退由 features/rollback.js 负责；文件和预览由 tools/file.js 的快照能力负责，
 * 这一层只把两边按用户看到的顺序串起来。
 *
 * 依赖按用途分组，同一个 feature 在这里只承担一种角色：
 *   Agent    会话装配与运行状态（create/invalidate/readSettings/resolve）
 *   History  会话数据的唯一读写口（load/add/save/destroy）
 *   Approval / Tool / ToolTiming  删除会话时的联动清理；工具快照供回退预览
 *   Rollback / Compact / Title / SessionGroups  各自动作的纯逻辑实现
 *
 * 调用示例：
 *   const { sessionId } = await Session.create({ title: '写爬虫', cwd: 'D:/notes' })
 *   const session = await Session.read({ sessionId })
 *   await Session.setCwd({ sessionId, cwd: 'D:/other' })
 *   await Session.rollback({ sessionId, messageId })
 */

import { stat } from 'node:fs/promises'
import store from '../store.js'
import Agent from '../features/agent.js'
import Approval from '../features/approval.js'
import Compact from '../features/compact.js'
import History from '../features/history.js'
import ContextUsage from '../utils/context-usage.js'
import Rollback from '../features/rollback.js'
import SessionGroups from '../features/session-groups.js'
import Title from '../features/title.js'
import Tool from '../features/tool.js'
import ToolTiming from '../features/tool-timing.js'
import SSE from '../utils/sse.js'
import Path from '../utils/path.js'
import TempWorkspace from '../utils/temp-workspace.js'
import fail from '../utils/fail.js'
import usageOf from '../utils/usage.js'

// --- 整理用户填的标题 ---
const cleanTitle = title => {
    if (typeof title !== 'string' || !title.trim()) throw fail(400, 'title must be a non-empty string')
    return title.trim()
}

// --- 新会话用哪个模型：点名了就查它，没点名就用配置里的对话默认 ---
const chooseModel = ({ provider, model }) => {
    const first = Agent.defaultModel()
    const namedProvider = typeof provider === 'string' && provider.trim() ? provider.trim() : ''
    const namedModel = typeof model === 'string' && model.trim() ? model.trim() : ''

    // 什么都没点名：用 config.models.chat。
    if (!namedProvider && !namedModel) {
        if (!first.provider) return { provider: '', model: '' }
        Agent.connection(first)
        return first
    }

    const name = namedProvider || first.provider
    if (!name) return { provider: '', model: '' }
    const info = (store.config.providers || []).find(item => item.name === name)
    if (!info) throw fail(400, `Provider not found: ${name}`)

    const own = info.models?.[0]
    const chosen = namedModel || own?.id || ''
    Agent.connection({ provider: name, model: chosen })
    return { provider: name, model: chosen }
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
    const chosen = chooseModel({ provider, model })
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
            settings: Agent.defaultSettings(),
        })
        await Agent.create({ sessionId: session.id })
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
            settings: await Agent.readSettings(sessionId),
        })
    } catch (error) {
        if (source.temporary) await TempWorkspace.remove(branchCwd, true).catch(() => {})
        throw error
    }
    // 历史复制到新目录，消息重新编号，分支之后的操作不会影响原会话。
    for (const { messageId: oldId, ...message } of kept) await History.add({ sessionId: branch.id, message })
    await History.save(branch.id)
    await Agent.create({ sessionId: branch.id })
    return { sessionId: branch.id }}

// --- 读取一条会话：默认返回完整历史；open 走 segmented，只给 manifest + 当前段 ---
const read = async ({ sessionId, onProgress, segmented = false }) => {
    await ContextUsage.hydrate(sessionId)
    const session = await History.load(sessionId, { onProgress })
    const agent = Agent.runtime().get(sessionId)
    const visible = history => history.filter(message => !message.internal)
    const running = Boolean(agent?.running)

    let history
    if (running) {
        history = visible(agent.history)
    } else {
        history = visible(History.get({ sessionId }))
        if (agent) agent.history = history
        // 打开会话只读历史，不在此时装配 Agent；MCP 连接可能阻塞首次发送。
    }
    const page = segmented ? History.page({ sessionId, history }) : null

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
        historyTotal: history.length,
        historyStats: historyUsage(history, session.model.provider, session.model.model),
        contextEstimate: ContextUsage.read(sessionId),
        todos: latestTodos(history),
        running,
        toolTimings: await ToolTiming.read(sessionId),
        pending: Approval.pending(sessionId),
        settings: await Agent.readSettings(sessionId),
        undoable: History.redoCount({ sessionId }),
    }
}

// --- 会话级用量聚合：统计必须基于完整历史，而不是前端最近窗口 ---
const MAX_TOKENS = 5_000_000
const safeTokens = value => {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 && number <= MAX_TOKENS ? Math.round(number) : 0
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
        const generation = durationMs > firstTokenMs ? durationMs - firstTokenMs : durationMs
        requests.push({
            input,
            output,
            cache: safeTokens(usage.cacheRead),
            cacheWrite: safeTokens(usage.cacheWrite),
            reasoning: safeTokens(usage.reasoning),
            total: safeTokens(usage.total) || input + output,
            provider: usage.provider || fallbackProvider,
            model: usage.model || fallbackModel,
            startedAt: Number(usage.startedAt || 0),
            finishedAt: Number(usage.finishedAt || 0),
            firstTokenMs,
            durationMs,
            tps: generation > 0 ? output / (generation / 1000) : 0,
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
        group.output += item.output
        if (item.durationMs > 0) {
            group.durationMs += item.durationMs
            group.durationCount += 1
            group.generationMs += item.durationMs > item.firstTokenMs ? item.durationMs - item.firstTokenMs : item.durationMs
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

// --- 从历史里取出最新一份任务清单 ---
const latestTodos = history => {
    for (const message of [...history].reverse()) {
        for (const part of Array.isArray(message.content) ? message.content : []) {
            if (part.type !== 'tool-result' || part.toolName !== 'update_todo_list') continue
            if (part.output?.value?.items) return part.output.value.items
        }
    }
    return []
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
const setModel = async ({ sessionId, provider, model }) => {
    const session = await History.load(sessionId)
    const chosen = typeof provider === 'string' && provider.trim() ? provider.trim() : session.model.provider
    const name = typeof model === 'string' && model.trim() ? model.trim() : session.model.model
    if (!chosen || !name) throw fail(400, 'provider and model must be non-empty strings')
    Agent.connection({ provider: chosen, model: name })

    session.model = { provider: chosen, model: name }
    session.updatedAt = Date.now()
    await History.save(sessionId)

    const agent = Agent.runtime().get(sessionId)
    if (agent?.running) {
        // core 0.30 每轮现读 agent.config；运行中只换配置，不重建实例、不中断当前任务。
        const settings = await Agent.readSettings(sessionId)
        Object.assign(agent.config, await Agent.resolve({ session, settings, target: { provider: chosen, model: name } }))
    } else {
        Agent.invalidate(sessionId)
        await Agent.create({ sessionId })
    }
    return { ...session, provider: chosen, model: name }
}

// --- 按后续对话重新生成标题 ---
const generateTitle = async ({ sessionId }) => {
    const session = await History.load(sessionId)
    const target = Agent.taskModel('title', session.model)
    const messages = History.get({ sessionId }).filter(message => !message.internal)
    const title = await Title.generate({ connection: Agent.connection(target), messages }) || Title.fallback(messages)
    if (title) {
        session.title = title
        session.updatedAt = Date.now()
        await History.save(sessionId)
        await SSE.send({ id: sessionId, data: { type: 'title', title } })
    }
    return { title: session.title }
}

// --- 换目录 ---
const setCwd = async ({ sessionId, cwd }) => {
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
    await SessionGroups.removeSession(sessionId).catch(error => console.error(`[session ${sessionId}] 清理分组失败：${error.message}`))
    ToolTiming.forget(sessionId)
    ContextUsage.remove(sessionId)
    return { ok: true }
}

const readSettings = async ({ sessionId }) => {
    await History.load(sessionId)
    return Agent.readSettings(sessionId)
}

const saveSettings = async ({ sessionId, ...change }) => Agent.saveSettings({ sessionId, ...change })

// --- 手动压缩 ---
const compact = async ({ sessionId }) => {
    const agent = await Agent.get({ sessionId })                         // 已经装配好的 agent
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

// --- 文件改动和工具回退 ---
const changes = async ({ sessionId }) => {
    await History.load(sessionId)
    return Tool.diff({ sessionId })
}

const toolChanges = async ({ sessionId }) => {
    await History.load(sessionId)
    return Tool.entries({ sessionId })
}

// --- 回退前先看会消失多少消息、哪些文件会被恢复 ---
const rollbackPreview = async ({ sessionId, messageId }) => {
    await History.load(sessionId)
    const plan = Rollback.preview({ history: History, sessionId, messageId })
    const droppedCalls = new Set(plan.toolCalls)
    const entries = await Tool.entries({ sessionId })
    const dropped = new Set()
    for (const entry of entries) {
        // 新快照记着真实调用 id，按它精确匹配；没有调用 id 的旧快照退回按消息归属判断。
        const hit = entry.toolCallId ? droppedCalls.has(entry.toolCallId) : !plan.keep.includes(entry.messageId)
        if (!hit) continue
        for (const path of entry.paths) dropped.add(path)
    }
    const files = (await Tool.diff({ sessionId })).filter(file => dropped.has(file.path))
    return { messages: plan.messages, toolCalls: plan.toolCalls, files }
}

// --- 消息和文件一起回退，也可以只退消息 ---
const rollback = async ({ sessionId, messageId, files = true }) => {
    await History.load(sessionId)
    if (Agent.runtime().get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)

    // 先算出回退后还留哪些消息块，再恢复文件；文件失败时消息保持原样。
    const plan = Rollback.preview({ history: History, sessionId, messageId })
    const restored = files ? await Tool.restoreMessage({ sessionId, keepMessages: plan.keep, dropToolCalls: plan.toolCalls }) : []
    await Rollback.messages({ history: History, agent: Agent, sessionId, messageId })
    return { ...await read({ sessionId }), restored }
}

// --- 只退某一次工具调用改的文件，对话不动 ---
const rollbackTool = async ({ sessionId, toolCallId, files = true }) => {
    await History.load(sessionId)
    if (Agent.runtime().get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)
    const restored = files
        ? await Tool.restoreTool({ sessionId, toolCallId })
        : await Tool.dropTool({ sessionId, toolCallId })
    return { restored }
}

// --- 撤销最近一次回退 ---
const redo = async ({ sessionId, files = true }) => {
    await History.load(sessionId)
    if (Agent.runtime().get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)

    const restored = files ? await Tool.undo({ sessionId }) : []
    await Rollback.undo({ history: History, agent: Agent, sessionId })
    return { ...await read({ sessionId }), restored }
}

// --- 统计会话数量 ---
const count = () => History.count()

// --- 历史分页与全会话大纲：前端只加载视口附近的历史 ---
const historyOutline = ({ sessionId }) => History.outline(sessionId)
const searchHistory = ({ sessionId, query, limit }) => History.search({ sessionId, query, limit })
const readHistorySegment = ({ sessionId, segmentId }) => History.segment({ sessionId, segmentId })

// --- 统计正在运行的任务 ---
const runningCount = () => Agent.runningCount()

export default {
    create, fork, list: History.list, read, rename, setModel, setCwd, generateTitle, remove,
    historyOutline, searchHistory,
    readHistorySegment,
    readSettings, saveSettings, compact,
    changes, toolChanges, rollbackPreview, rollback, rollbackTool, redo,
    count, runningCount,
}
