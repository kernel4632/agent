/*
 * 会话与 Agent 指令：创建会话、读取会话、改标题、删除、回退、压缩、发送消息、停止。
 *
 * 每个会话在磁盘上是一个目录（meta.json + history.json + settings.json + snapshots/），在内存里对应一台 Agent。
 * 调用示例：
 *   const { sessionId } = await Session.create({ title: '写爬虫' })
 *   await Session.send({ sessionId, input: '帮我写个爬虫' })   // 启动后台任务，过程走 SSE
 *   await Session.resume({ sessionId })                        // 继续被中断的助手回复，内部提示不保存
 *   await Session.stop({ sessionId })
 *   const session = await Session.read({ sessionId })          // { id, title, provider, model, history }
 *   await Session.rollback({ sessionId, messageId })           // 对话和文件一起回退到这条消息之前
 *   await Session.redo({ sessionId })
 *   await Session.compact({ sessionId })
 *   await Session.remove({ sessionId })
 */

import { readdir, rm } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import Approval from '../safety/approval.js' // 审批工具调用，顺带记录文件快照。
import Config from '../config/config.js' // 读取全局模型配置和权限规则。
import Settings from '../config/settings.js' // 会话运行设置：模式、自动批准、能力开关。
import History from './history.js' // 读写当前会话消息。
import Meta from './meta.js' // 读写会话资料。
import AgentSession from './agent.js' // 装配和获取会话的 Agent。
import SessionRead from './read.js' // 读取完整会话和任务清单。
import Rollback from './rollback.js' // 消息级、工具级回退和撤销。
import Run from './run.js' // 发送、继续和停止任务。
import Snapshot from './snapshot.js' // 删除会话时清理文件快照。
import Store from '../store.js' // 直接访问会话到 Agent 实例的映射。
import Path from '../utils/path.js' // 生成数据目录路径。
import fail from '../utils/fail.js' // 找不到会话、输入为空等业务错误带上状态码。
import SSE from '../utils/sse.js' // 把运行过程反馈给前端。

// --- 列出磁盘上的全部会话 ---
const list = async ({ search = '' } = {}) => {
    const root = Path.sessions()
    // 第一次运行时这个目录还不存在，列出来是空的而不是报错。
    const entries = await readdir(root).catch(() => [])
    const sessions = []

    for (const entry of entries) {
        const file = Bun.file(Path.meta(entry))
        // 目录里可能有别的残留文件，只认带 meta.json 的会话目录。
        if (!await file.exists()) continue
        const meta = await file.json()
        // 搜索按标题和模型名匹配，用户记得的通常是这两样。
        if (search && !`${meta.title} ${meta.model}`.toLowerCase().includes(search.toLowerCase())) continue
        sessions.push(meta)
    }

    // 最近用过的排在前面，用户找回会话时不用往下翻。
    sessions.sort((first, second) => (second.updatedAt || 0) - (first.updatedAt || 0))
    return sessions
}

// --- 整理用户填的标题 ---
const cleanTitle = title => {
    // 好几个指令都从用户那里收标题，所以检查只写在这里一处。
    // 先去掉首尾空格再看是不是空的，否则只填空格的标题也能存进去。
    if (typeof title !== 'string' || !title.trim()) throw fail(400, 'title must be a non-empty string')
    return title.trim()
}

// --- 创建会话 ---
const create = async ({ title, workspaceId, provider, model }) => {
    const clean = cleanTitle(title)
    const selected = Config.firstModel()
    const meta = {
        id: nanoid(),
        title: clean,
        workspaceId,
        provider: provider || selected.provider,
        model: model || selected.model,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    }

    await Meta.write(meta)
    await History.load({ sessionId: meta.id })
    await History.save({ sessionId: meta.id })
    await AgentSession.create({ sessionId: meta.id, history: History.get({ sessionId: meta.id }), meta })
    return { sessionId: meta.id }
}

/**
 * 从一条会话分出一个新分支。
 * 默认复制全部历史；给 messageId 时只复制到这条消息（含）。
 * 文件快照不复制：分支和原会话共用同一个工作区，之前的文件改动不属于分支自己的时间线。
 * @param {{ sessionId: string, title?: string, messageId?: string }} source
 * @returns {Promise<{ sessionId: string }>} 新分支的编号。
 * @throws {Error} 会话在跑或消息不存在时按冲突 / 找不到处理。
 */
const fork = async ({ sessionId, title, messageId }) => {
    const source = await Meta.read(sessionId)
    if (Store.agents.get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)

    await History.load({ sessionId })
    const messages = History.get({ sessionId })
    let kept = messages
    if (messageId) {
        const index = messages.findIndex(message => message.messageId === messageId)
        if (index < 0) throw fail(404, `Message not found: ${messageId}`)
        kept = messages.slice(0, index + 1)
    }

    const id = nanoid()
    const clean = typeof title === 'string' && title.trim() ? title.trim() : `${source.title}（分支）`
    const meta = {
        ...source,
        id,
        title: clean.slice(0, 120),
        createdAt: Date.now(),
        updatedAt: Date.now(),
    }
    await Meta.write(meta)

    // 历史复制到新目录，消息块重新编号，分支之后的操作不会影响原会话。
    await History.load({ sessionId: id })
    for (const { messageId: ignored, ...message } of kept) await History.add({ sessionId: id, message })
    await History.save({ sessionId: id })

    // 分支沿用原会话的模式、自动批准和能力开关。
    const settings = await Settings.read({ sessionId })
    await Settings.save({ sessionId: id, ...settings })
    await AgentSession.create({ sessionId: id, history: History.get({ sessionId: id }), meta })
    return { sessionId: id }
}

// --- 重命名会话 ---
const rename = async ({ sessionId, title }) => {
    const clean = cleanTitle(title)
    const meta = await Meta.read(sessionId)
    meta.title = clean
    meta.updatedAt = Date.now()
    return Meta.write(meta)
}

/**
 * 换这条会话使用的模型。
 * 供应商必须在配置里存在；模型名不做白名单校验，用户可以先填一个还没写进列表的名字。
 * @param {{ sessionId: string, provider?: string, model?: string }} change
 * @returns {Promise<object>} 更新后的会话元信息。
 * @throws {Error} 任务在跑时按冲突处理（409），供应商不存在按填错处理（400）。
 */
const setModel = async ({ sessionId, provider, model }) => {
    const meta = await Meta.read(sessionId)
    if (Store.agents.get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)

    const chosenProvider = typeof provider === 'string' && provider.trim() ? provider.trim() : meta.provider
    const chosenModel = typeof model === 'string' && model.trim() ? model.trim() : meta.model
    if (!chosenProvider || !chosenModel) throw fail(400, 'provider and model must be non-empty strings')
    Config.connection({ provider: chosenProvider, model: chosenModel }) // 供应商不存在时在这里报 400。

    meta.provider = chosenProvider
    meta.model = chosenModel
    meta.updatedAt = Date.now()
    await Meta.write(meta)

    // 重建 Agent：压缩等功能用的是 Agent 自己手里的 config，只改 meta 不会跟着换。
    Store.agents.delete(sessionId)
    await History.load({ sessionId })
    await AgentSession.create({ sessionId, history: History.get({ sessionId }), meta })
    return meta
}

// --- 删除会话 ---
const remove = async ({ sessionId }) => {
    await Meta.read(sessionId)
    if (Store.agents.get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)
    Store.agents.delete(sessionId)
    Store.recentCalls.delete(sessionId)
    Settings.remove({ sessionId })
    History.remove({ sessionId })              // 内存里的历史也一起删，健康检查不能再算它。
    await Snapshot.remove({ sessionId })       // 会话没了，它的文件快照也不再需要。
    await rm(Path.session(sessionId), { recursive: true, force: true })
    return { ok: true }
}

/**
 * 读这条会话的运行设置：模式、自动批准、能力开关。
 * @param {{ sessionId: string }} session
 * @returns {Promise<object>} 完整设置。
 */
const readSettings = async ({ sessionId }) => {
    await Meta.read(sessionId)
    return Settings.read({ sessionId })
}

/**
 * 改这条会话的运行设置，只改点名的那几项。
 *
 * 只有智能体和能力开关需要重新装配 Agent（工具表和能力都建在 Agent 上），
 * 自动批准不用：审批时是现读设置的，改完下一次工具调用就按新设置走。
 * 所以自动批准可以在任务跑着的时候随时改——用户看到模型在乱改文件时，
 * 要能当场把"写入"关掉，而不是先停下来再改。
 * @param {{ sessionId: string } & object} change
 * @returns {Promise<object>} 保存后的完整设置。
 * @throws {Error} 需要换工具表或能力时任务正在跑，按冲突处理（409）。
 */
const saveSettings = async ({ sessionId, ...change }) => {
    const meta = await Meta.read(sessionId)
    const current = await Settings.read({ sessionId })

    // 改的是自动批准，别的都没动——不重建，也就没有"任务在跑"这一说。
    const onlyAutoApprove = Object.keys(change).every(key => key === 'autoApprove')
    // 智能体和能力换掉之后必须重建 Agent 才生效，所以这时候不能让任务在跑。
    // 这一关要在写盘之前过：被拒的改动不该留在磁盘上。
    if (!onlyAutoApprove && Store.agents.get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)

    // 智能体自己指定了模型时，先确认供应商还存在，再写设置。
    // 写反了顺序会留下"设置已经改了、模型却建不出来"的半坏状态。
    const requested = change.agent !== undefined ? change.agent : change.mode
    const requestedInfo = requested !== undefined ? Settings.agentInfo(requested) : null
    if (requestedInfo?.model) Config.connection(requestedInfo.model)

    const saved = await Settings.save({ sessionId, ...change })
    if (onlyAutoApprove) return saved
    // 什么都没变就不白重建一次，免得把正在等待的审批也一并打散。
    if (settingsEqual(current, saved)) return saved

    // 智能体自带模型时，把会话当前模型切过去；切到不带模型的智能体时保留原模型。
    // 这样顶栏、标题生成和压缩看到的都是实际在用的那个模型。
    const agent = Settings.agentInfo(saved.agent)
    if (saved.agent !== current.agent && agent?.model) {
        meta.provider = agent.model.provider
        meta.model = agent.model.model
        meta.updatedAt = Date.now()
        await Meta.write(meta)
    }

    // 历史原样交回去，不丢消息。
    Store.agents.delete(sessionId)
    await History.load({ sessionId })
    await AgentSession.create({ sessionId, history: History.get({ sessionId }), meta })
    return saved
}

// --- 两份设置是不是同一份 ---
// 设置是普通对象套布尔值，直接序列化比较就够；两边都由同一套默认值构造，字段顺序一致。
const settingsEqual = (first, second) => JSON.stringify(first) === JSON.stringify(second)


    // --- 压缩会话历史 ---
const compact = async ({ sessionId }) => {
    const meta = await Meta.read(sessionId)
    const agent = await AgentSession.get({ sessionId, meta })
    if (agent.running) throw fail(409, `Agent is already running: ${sessionId}`)
    // 模型地址没填时压缩必然失败。说清是配置问题，别报成程序错误让用户以为软件坏了。
    if (!agent.config.baseURL || !agent.config.model) throw fail(400, `Session has no model configured: ${sessionId}`)

    // 压缩只往历史里追加一条总结，被总结的原文仍然留在磁盘上。
    const startLength = agent.history.length
    const content = await agent.compact({ onCompact: event => SSE.send({ id: sessionId, data: event }) })
    for (const message of agent.history.slice(startLength)) await History.add({ sessionId, message })
    await History.save({ sessionId })
    return { ...await SessionRead.read({ sessionId }), content }
}

// --- 处理工具审批 ---
const decide = ({ sessionId, toolCallId, decision }) => Approval.decide({ sessionId, toolCallId, decision })

// --- 统计会话数量 ---
const count = () => History.count()

// --- 统计正在运行的任务 ---
const runningCount = () => [...Store.agents.values()].filter(agent => agent.running).length

export default {
    list, create, rename, remove, setModel, fork,
    read: SessionRead.read,
    ...Rollback,
    ...Run,
    readSettings, saveSettings,
    compact, decide, count, runningCount,
}
