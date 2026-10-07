/*
 * 会话与 Agent 指令：创建会话、读取会话、改标题、删除、回退、压缩、发送消息、停止。
 *
 * 每个会话在磁盘上是一个目录（meta.json + history.json + snapshots/），在内存里对应一台 Agent。
 * 调用示例：
 *   const { sessionId } = await Session.create({ title: '写爬虫' })
 *   await Session.send({ sessionId, input: '帮我写个爬虫' })   // 启动后台任务，过程走 SSE
 *   await Session.stop({ sessionId })
 *   const session = await Session.read({ sessionId })          // { id, title, provider, model, history }
 *   await Session.rollback({ sessionId, messageId })           // 对话和文件一起回退到这条消息之前
 *   await Session.redo({ sessionId })
 *   await Session.compact({ sessionId })
 *   await Session.remove({ sessionId })
 */

import { mkdir, readdir, rm } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import { writeFile } from 'atomically'
import Agent from '@kernel4632/agent-core'
import Approval from '../features/approval.js' // 审批工具调用，顺带记录文件快照。
import Delegation from '../features/delegation.js' // 把独立探索工作委托给子 agent。
import Mcp from '../features/mcp.js' // 把设置里配置的外部工具服务连上。
import Skills from '../features/skills.js' // 数据目录里的技能，按需读正文。
import Config from './config.js' // 读取全局模型配置和权限规则。
import History from '../features/history.js' // 读写当前会话消息。
import Snapshot from '../features/snapshot.js' // 回退时把文件一起恢复。
import Store from '../store.js' // 直接访问会话到 Agent 实例的映射。
import Path from '../utils/path.js' // 生成数据目录路径。
import fail from '../utils/fail.js' // 找不到会话、输入为空等业务错误带上状态码。
import SSE from '../utils/sse.js' // 把运行过程反馈给前端。
// --- 准备数据目录 ---
const prepare = async () => {
    // 首次启动时数据目录还不存在，先建出来，后面所有读写都不用再判断目录在不在。
    await mkdir(Path.root(), { recursive: true })
    await mkdir(Path.tools(), { recursive: true })
}

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

// --- 判断会话是否正在跑任务 ---
const isRunning = sessionId => Boolean(Store.agents.get(sessionId)?.running)

// --- 读取会话资料 ---
const readMeta = async sessionId => {
    const file = Bun.file(Path.meta(sessionId))
    // 元数据不存在说明会话不存在，必须反馈 404 语义给调用方。
    if (!await file.exists()) throw fail(404, `Session not found: ${sessionId}`)
    return file.json()
}

// --- 保存会话资料 ---
const writeMeta = async meta => {
    // 先创建会话目录，再原子写入元数据，避免留下半份 JSON。
    await mkdir(Path.session(meta.id), { recursive: true })
    await writeFile(Path.meta(meta.id), JSON.stringify(meta, null, 2))
    return meta
}

// --- 创建 Agent 实例 ---
const createAgent = async ({ sessionId, history, meta }) => {
    // 内置工具跟着代码走，用户工具放在数据目录，同名时用户版覆盖内置版。
    // 用户工具目录可能在启动流程之外被用到（测试、脚本），这里直接建出来不让它缺。
    await mkdir(Path.tools(), { recursive: true })
    // 配置格式转换只写在 Config 里，子 agent 用的也是同一份。
    const config = Config.resolve({ provider: meta.provider, model: meta.model })

    // 三类工具一起交给模型：内置的文件工具、用户自己写的、设置里配的 MCP 服务。
    // 技能不作为工具全集出现，只给一个"读技能正文"的工具，正文等模型要用时才去读。
    const scanned = await Agent.tool.from(
        new URL('../tools/', import.meta.url),
        Path.tools(),
        await Mcp.tools(),
        await Skills.tools(),
    )

    // task 必须在同一进程里才有模型配置和工具表可用，所以它是内存工具而不是文件工具。
    // merge 把已经装好的文件工具表和这一件内存工具合起来，两边形状不用自己转。
    const tools = Agent.tool.merge(scanned, Agent.tool.adopt({ task: Delegation.build({ config, tools: scanned }) }))

    const agent = Agent.create({
        id: sessionId,
        history,
        config,
        tools,
        callbacks: { onPermission: Approval.check }, // 工具执行前先过一次忽略规则和权限规则。
    })
    Store.agents.set(sessionId, agent)
    return agent
}

// --- 获取或创建 Agent ---
const getAgent = async ({ sessionId, meta }) => {
    const current = Store.agents.get(sessionId)
    if (current) return current
    await History.load({ sessionId })
    return createAgent({ sessionId, history: History.get({ sessionId }), meta })
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

    await writeMeta(meta)
    await History.load({ sessionId: meta.id })
    await History.save({ sessionId: meta.id })
    await createAgent({ sessionId: meta.id, history: History.get({ sessionId: meta.id }), meta })
    return { sessionId: meta.id }
}

// --- 读取会话 ---
const read = async ({ sessionId }) => {
    const meta = await readMeta(sessionId)
    const agent = Store.agents.get(sessionId)

    // 运行中的会话以 Agent 手里的历史为准，磁盘上还没有这一轮的新消息。
    if (agent?.running) return { ...meta, history: agent.history }

    await History.load({ sessionId })
    const history = History.get({ sessionId })
    if (agent) agent.history = history // 历史被回退或外部修改过，交回 Agent 手里的必须是最新的。
    else await createAgent({ sessionId, history, meta })
    // 清单本来就在历史里（todo 工具的结果），这里只是提出来，让界面不用自己翻。
    // 审批请求只在 SSE 里出现过一次，刷新页面后要靠这里才知道有工具在等待。
    // undoable 是还能撤销几次回退，界面据此决定要不要显示"撤销回退"。
    return {
        ...meta,
        history,
        todos: latestTodos(history),
        running: isRunning(sessionId),
        pending: Approval.pending(sessionId),
        undoable: History.redoCount({ sessionId }),
    }
}

// --- 从历史里取出最新一份任务清单 ---
const latestTodos = history => {
    // 从后往前找最后一次 todo 调用，用户要看的是"现在还剩什么"。
    for (const message of [...history].reverse()) {
        for (const part of Array.isArray(message.content) ? message.content : []) {
            if (part.type === 'tool-result' && part.toolName === 'todo' && part.output?.value?.items) return part.output.value.items
        }
    }
    return []
}

// --- 重命名会话 ---
const rename = async ({ sessionId, title }) => {
    const clean = cleanTitle(title)
    const meta = await readMeta(sessionId)
    meta.title = clean
    meta.updatedAt = Date.now()
    return writeMeta(meta)
}

// --- 删除会话 ---
const remove = async ({ sessionId }) => {
    await readMeta(sessionId)
    if (Store.agents.get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)
    Store.agents.delete(sessionId)
    await Snapshot.remove({ sessionId }) // 会话没了，它的文件快照也不再需要。
    await rm(Path.session(sessionId), { recursive: true, force: true })
    return { ok: true }
}

// --- 回退会话 ---
const rollback = async ({ sessionId, messageId, files = true }) => {
    await readMeta(sessionId)
    if (Store.agents.get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)
    await History.load({ sessionId })

    // 对话和文件是两件可以分开的事：用户可能只想把对话退回去接着问，也可能只想丢掉
    // agent 改的文件而留着对话看它做了什么。files 传 false 就只退对话。
    let restored = []
    if (files) {
        // 先算出回退后还留下哪些消息块，再恢复文件；文件恢复失败时对话保持原样，
        // 不会出现"消息没了但文件还在"的中间状态。
        restored = await Snapshot.restore({ sessionId, keep: History.idsBefore({ sessionId, messageId }) })
    }
    await History.rollback({ sessionId, messageId })
    await History.save({ sessionId })
    const agent = Store.agents.get(sessionId)
    if (agent) agent.history = History.get({ sessionId })
    return { ...await read({ sessionId }), restored }
}

// --- 看这次任务改了哪些文件 ---
const changes = async ({ sessionId }) => {
    await readMeta(sessionId)
    // 快照记的是"任务开始时的原样"，所以这里给出的就是 agent 实际造成的改动。
    return Snapshot.diff({ sessionId })
}

// --- 回退之前先看会改动什么 ---
const rollbackPreview = async ({ sessionId, messageId }) => {
    await readMeta(sessionId)
    await History.load({ sessionId })
    // 用户点回退之前要能看清代价：多少条消息会消失、哪些文件会被恢复。
    const history = History.get({ sessionId })
    const index = history.findIndex(message => message.messageId === messageId)
    if (index < 0) throw fail(404, `Message not found: ${messageId}`)

    const keep = history.slice(0, index).map(message => message.id)
    // 只列会被回退掉的那一段碰过的文件。
    const droppedPaths = new Set()
    for (const entry of Snapshot.active({ sessionId })) {
        if (keep.includes(entry.messageId)) continue
        for (const path of Object.keys(entry.files)) droppedPaths.add(path)
    }

    return {
        messages: history.length - index,                                     // 会消失的消息条数
        files: (await Snapshot.diff({ sessionId })).filter(file => droppedPaths.has(file.path)),
    }
}

// --- 撤销回退 ---
const redo = async ({ sessionId, files = true }) => {
    await readMeta(sessionId)
    if (Store.agents.get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)
    await History.load({ sessionId })

    // 撤销回退也是对话和文件分开的两件事，和回退时一一对应。
    // 每撤销一次就退掉一层，所以可以连着撤销好几步。
    const restored = files ? await Snapshot.undo({ sessionId }) : []
    await History.redo({ sessionId })
    await History.save({ sessionId })
    const agent = Store.agents.get(sessionId)
    if (agent) agent.history = History.get({ sessionId })
    return { ...await read({ sessionId }), restored }
}

// --- 压缩会话历史 ---
const compact = async ({ sessionId }) => {
    const meta = await readMeta(sessionId)
    const agent = await getAgent({ sessionId, meta })
    if (agent.running) throw fail(409, `Agent is already running: ${sessionId}`)
    // 模型地址没填时压缩必然失败。说清是配置问题，别报成程序错误让用户以为软件坏了。
    if (!agent.config.baseURL || !agent.config.model) throw fail(400, `Session has no model configured: ${sessionId}`)

    // 压缩只往历史里追加一条总结，被总结的原文仍然留在磁盘上。
    const startLength = agent.history.length
    const content = await agent.compact({ onCompact: event => SSE.send({ id: sessionId, data: event }) })
    for (const message of agent.history.slice(startLength)) await History.add({ sessionId, message })
    await History.save({ sessionId })
    return { ...await read({ sessionId }), content }
}

// --- 启动 Agent 任务 ---
const send = async ({ sessionId, input }) => {
    // 用户输入在这里检查一次：去掉首尾空格后不能为空。
    if (typeof input !== 'string' || !input.trim()) throw fail(400, 'input must be a non-empty string')
    const meta = await readMeta(sessionId)
    const agent = await getAgent({ sessionId, meta })

    // 新消息代表新的时间线，之前的回退不能再撤销了。
    await Snapshot.clearUndo({ sessionId })

    // Agent 运行过程产生的每一段都通过 SSE 推给前端，前端只认事件类型。
    const startLength = agent.history.length
    const task = agent.send({
        input: input.trim(),
        config: Config.resolve({ provider: meta.provider, model: meta.model }),
        callbacks: {
            onStart: () => SSE.send({ id: sessionId, data: { type: 'agent-start' } }),
            onLLMStart: request => SSE.send({ id: sessionId, data: { type: 'llm-start', ...request } }),
            onLLMFinish: result => SSE.send({ id: sessionId, data: { type: 'llm-finish', ...result } }),
            onLLMEvent: event => SSE.send({ id: sessionId, data: event }),
            onRetry: info => SSE.send({ id: sessionId, data: { type: 'retry', ...info } }),
            onToolCall: call => SSE.send({ id: sessionId, data: { ...call, type: 'tool-call' } }),
            onToolOutput: output => SSE.send({ id: sessionId, data: { ...output, type: 'tool-output' } }),
            onToolResult: result => SSE.send({ id: sessionId, data: { ...result, type: 'tool-result' } }),
            onCompact: event => SSE.send({ id: sessionId, data: event }),
            // 快照挂在这一轮的用户消息上，回退到它就回到这轮开始前的样子。
            // 这个 id 必须在这时候才取：Agent 内部要先 await 停止上一个任务，才会把用户消息
            // 写进历史，所以 send 一返回就取会取到上一轮的那条。这里已经是跑工具的阶段，
            // 消息早就进去了。也不要自己造一个 id —— 那样和历史里那条对不上，回退会找不到快照。
            onPermission: ({ toolCallId, toolName, input: toolInput, signal }) => Approval.check({
                sessionId,
                messageId: agent.history.findLast(message => message.role === 'user')?.id,
                toolCallId,
                toolName,
                input: toolInput,
                signal,
            }),
        },
    })

    // 任务结束后把这一轮新增的消息写进历史文件，再通知前端刷新。
    task.then(async result => {
        for (const message of agent.history.slice(startLength)) await History.add({ sessionId, message })
        await History.save({ sessionId })
        await SSE.send({ id: sessionId, data: { type: 'agent-finish', ...result } })
    }).catch(error => SSE.send({ id: sessionId, data: { type: 'agent-finish', error: error.message } }))
    return { ok: true }
}

// --- 停止 Agent 任务 ---
const stop = ({ sessionId }) => Store.agents.get(sessionId)?.stop() || { ok: false }

// --- 处理工具审批 ---
const decide = ({ sessionId, toolCallId, decision }) => Approval.decide({ sessionId, toolCallId, decision })

// --- 统计会话数量 ---
const count = () => Store.sessions.size

// --- 统计正在运行的任务 ---
const runningCount = () => [...Store.agents.values()].filter(agent => agent.running).length

export default { prepare, list, create, read, rename, remove, rollback, rollbackPreview, redo, changes, compact, send, stop, decide, count, runningCount }
