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

import { mkdir, readdir, rm } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import { writeFile } from 'atomically'
import Agent from '@kernel4632/agent-core'
import Approval from '../features/approval.js' // 审批工具调用，顺带记录文件快照。
import Delegation from '../features/delegation.js' // 把独立探索工作委托给子 agent。
import Mcp from '../features/mcp.js' // 把设置里配置的外部工具服务连上。
import Rules from '../features/rules.js' // 工作区的项目规则，跟着 system 一起交给模型。
import Skills from '../features/skills.js' // 数据目录里的技能，按需读正文。
import Title from '../features/title.js' // 第一次聊完让模型起个标题。
import Config from './config.js' // 读取全局模型配置和权限规则。
import Settings from './settings.js' // 会话运行设置：模式、自动批准、能力开关。
import Kind from '../utils/tool-kind.js' // 工具分类只有一处，plan 模式用不着自己写名单。
import { canonical } from '../utils/tool-names.js' // 历史里旧工具名也能认出对应结果。
import History from '../features/history.js' // 读写当前会话消息。
import Snapshot from '../features/snapshot.js' // 回退时把文件一起恢复。
import Store from '../store.js' // 直接访问会话到 Agent 实例的映射。
import Path from '../utils/path.js' // 生成数据目录路径。
import fail from '../utils/fail.js' // 找不到会话、输入为空等业务错误带上状态码。
import SSE from '../utils/sse.js' // 把运行过程反馈给前端。
/*
 * 还没起标题的会话叫什么。
 * 会话一建出来就叫这个名字，起标题时判断"该不该动手"也看它——
 * 用户手动改过标题之后就不该被覆盖，而改过的标题一定不等于这个名字。
 */
const UNTITLED = '新对话'

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
/**
 * 为一个会话建出 Agent 实例。
 *
 * 工具表在这里装配：内置工具、用户工具、MCP 服务、技能读写口，最后按会话模式去掉写工具。
 * plan 模式就是靠这一步做到只读，而不是往系统提示词里写"请不要改文件"。
 * @param {{ sessionId: string, history: object[], meta: object }} input
 * @returns {Promise<object>} 建好的 Agent 实例，已放进 Store.agents。
 */
const createAgent = async ({ sessionId, history, meta }) => {
    // 内置工具跟着代码走，用户工具放在数据目录，同名时用户版覆盖内置版。
    // 用户工具目录可能在启动流程之外被用到（测试、脚本），这里直接建出来不让它缺。
    await mkdir(Path.tools(), { recursive: true })
    // 会话的运行设置：模式、自动批准、能力开关。
    const settings = await Settings.read({ sessionId })
    // 规则跟着工作区和模式走；每次重建 Agent 都重读一次，用户改完规则不用重启服务。
    await Rules.load({ mode: settings.mode })
    // 配置格式转换只写在 Config 里，子 agent 用的也是同一份；
    // 能力开关作为会话级覆盖并进去，system 保持用户原样，不做任何注入。
    const config = Config.resolve({ provider: meta.provider, model: meta.model, settings: Settings.toAgentConfig({ settings }) })

    // 三类工具一起交给模型：内置的文件工具、用户自己写的、设置里配的 MCP 服务。
    // 技能不作为工具全集出现，只给一个"读技能正文"的工具，正文等模型要用时才去读。
    const scanned = await Agent.tool.from(
        new URL('../tools/', import.meta.url),
        Path.tools(),
        await Mcp.tools(),
        await Skills.tools(),
    )

    /*
     * 自定义模式可以点名只给哪些工具；内置的 build / plan 不点名。
     * 点名的名单里不存在的工具直接忽略，用户写错一个名字不该让整个会话打不开。
     */
    const toolNames = Settings.toolsFor({ mode: settings.mode })
    let allowed = toolNames
        ? Agent.tool.pick(scanned, toolNames.filter(name => name in scanned.schema))
        : scanned

    /*
     * readOnly 模式去掉能改磁盘的工具。哪些算"能改"由 utils/tool-kind.js 一处说了算，
     * 这里只是把它对当前工具表算一遍，不另外维护一份名单。
     * omit 会把 schema 和 handlers 一起筛，不会出现"模型看不见、却还能被执行"的隐蔽状态。
     *
     * 这一步必须在装 new_task 之前做：子 agent 拿的是这里选出来的这张表。
     * 反过来（先装 new_task 再筛）会留一个口子——只读模式的模型自己虽然改不了文件，
     * 但它可以开一个子任务，让子任务去改，等于绕过了"只看不做"。
     */
    if (config.readOnly) allowed = Agent.tool.omit(allowed, Kind.writing(Object.keys(allowed.schema)))

    // new_task 必须在同一进程里才有模型配置和工具表可用，所以它是内存工具而不是文件工具。
    // merge 把已经装好的文件工具表和这一件内存工具合起来，两边形状不用自己转。
    // 自定义模式没点名 new_task 时就不装，让"只留几个工具"真的只留那几个。
    const withTask = !toolNames || toolNames.includes('new_task')
    const tools = withTask
        ? Agent.tool.merge(allowed, Agent.tool.adopt({ new_task: Delegation.build({ config, tools: allowed, sessionId }) }))
        : allowed
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

/**
 * 从一条会话分出一个新分支。
 * 默认复制全部历史；给 messageId 时只复制到这条消息（含）。
 * 文件快照不复制：分支和原会话共用同一个工作区，之前的文件改动不属于分支自己的时间线。
 * @param {{ sessionId: string, title?: string, messageId?: string }} source
 * @returns {Promise<{ sessionId: string }>} 新分支的编号。
 * @throws {Error} 会话在跑或消息不存在时按冲突 / 找不到处理。
 */
const fork = async ({ sessionId, title, messageId }) => {
    const source = await readMeta(sessionId)
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
    await writeMeta(meta)

    // 历史复制到新目录，消息块重新编号，分支之后的操作不会影响原会话。
    await History.load({ sessionId: id })
    for (const { messageId: ignored, ...message } of kept) await History.add({ sessionId: id, message })
    await History.save({ sessionId: id })

    // 分支沿用原会话的模式、自动批准和能力开关。
    const settings = await Settings.read({ sessionId })
    await Settings.save({ sessionId: id, ...settings })
    await createAgent({ sessionId: id, history: History.get({ sessionId: id }), meta })
    return { sessionId: id }
}

// --- 读取会话 ---
const read = async ({ sessionId }) => {
    const meta = await readMeta(sessionId)               // 先确认会话存在，不存在时按 404 反馈。
    const agent = Store.agents.get(sessionId)            // 内存里有 Agent 时，运行中的历史以它为准。
    // 继续指令只给模型看，不能作为用户消息出现在界面上。
    const visible = history => history.filter(message => !message.internal)
    const running = Boolean(agent?.running)

    let history
    if (running) {
        // 运行中的会话以 Agent 手里的历史为准，磁盘上还没有这一轮的新消息。
        history = visible(agent.history)
    } else {
        await History.load({ sessionId })
        history = History.get({ sessionId })
        if (agent) agent.history = history                  // 历史被回退或外部修改过，交回 Agent 手里的必须是最新的。
        else await createAgent({ sessionId, history, meta })
    }

    // 运行和空闲两种状态只差历史从哪里取，返回的字段始终是同一份。
    // todos 本来就在历史里（update_todo_list 工具的结果），这里提出来让界面不用自己翻。
    // pending 是还在等用户批准的工具；undoable 是还能撤销几次回退。
    return {
        ...meta,
        history,
        todos: latestTodos(history),
        running,
        pending: Approval.pending(sessionId),
        settings: await Settings.read({ sessionId }),     // 模式和开关，界面据此显示当前状态。
        undoable: History.redoCount({ sessionId }),
    }
}

// --- 从历史里取出最新一份任务清单 ---
const latestTodos = history => {
    // 从后往前找最后一次清单调用，用户要看的是"现在还剩什么"。
    for (const message of [...history].reverse()) {
        for (const part of Array.isArray(message.content) ? message.content : []) {
            if (part.type !== 'tool-result' || canonical(part.toolName) !== 'update_todo_list') continue
            if (part.output?.value?.items) return part.output.value.items
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

/**
 * 换这条会话使用的模型。
 * 供应商必须在配置里存在；模型名不做白名单校验，用户可以先填一个还没写进列表的名字。
 * @param {{ sessionId: string, provider?: string, model?: string }} change
 * @returns {Promise<object>} 更新后的会话元信息。
 * @throws {Error} 任务在跑时按冲突处理（409），供应商不存在按填错处理（400）。
 */
const setModel = async ({ sessionId, provider, model }) => {
    const meta = await readMeta(sessionId)
    if (Store.agents.get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)

    const chosenProvider = typeof provider === 'string' && provider.trim() ? provider.trim() : meta.provider
    const chosenModel = typeof model === 'string' && model.trim() ? model.trim() : meta.model
    if (!chosenProvider || !chosenModel) throw fail(400, 'provider and model must be non-empty strings')
    Config.connection({ provider: chosenProvider, model: chosenModel }) // 供应商不存在时在这里报 400。

    meta.provider = chosenProvider
    meta.model = chosenModel
    meta.updatedAt = Date.now()
    await writeMeta(meta)

    // 重建 Agent：压缩等功能用的是 Agent 自己手里的 config，只改 meta 不会跟着换。
    Store.agents.delete(sessionId)
    await History.load({ sessionId })
    await createAgent({ sessionId, history: History.get({ sessionId }), meta })
    return meta
}

// --- 删除会话 ---
const remove = async ({ sessionId }) => {
    await readMeta(sessionId)
    if (Store.agents.get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)
    Store.agents.delete(sessionId)
    Store.recentCalls.delete(sessionId)
    Settings.remove({ sessionId })
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
        restored = await Snapshot.restoreToMessage({ sessionId, keepMessages: History.idsBefore({ sessionId, messageId }) })
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
/**
 * 回退之前先算清楚会改动什么，别让用户盲目确认。
 * @param {{ sessionId: string, messageId: string }} target 要回退到这条消息之前。
 * @returns {Promise<{ messages: number, files: object[] }>} 会消失的消息条数和会被恢复的文件。
 * @throws {Error} 消息不在这个会话里时按填错处理（404）。
 */
const rollbackPreview = async ({ sessionId, messageId }) => {
    await readMeta(sessionId)
    await History.load({ sessionId })
    const history = History.get({ sessionId })
    const index = history.findIndex(message => message.messageId === messageId)
    if (index < 0) throw fail(404, `Message not found: ${messageId}`)

            const keep = history.slice(0, index).map(message => message.id)
            return {
                messages: history.length - index,                                     // 会消失的消息条数
                files: await changedFiles({ sessionId, keep: entry => keep.includes(entry.messageId) }),
            }
        }
        
        /**
         * 退回某一次工具调用之前：只影响文件，对话不动。
         * 这是比消息回退细一层的粒度——某一个工具把文件改坏了，用户不用丢掉整轮对话。
         * @param {{ sessionId: string, toolCallId: string, files?: boolean }} target
         *   files 传 false 时只把这次调用从记录里去掉，磁盘上的文件保持现在的样子。
         * @returns {Promise<{ restored: string[] }>} 被恢复的文件绝对路径。
         */
        const rollbackTool = async ({ sessionId, toolCallId, files = true }) => {
            await readMeta(sessionId)
            if (Store.agents.get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)
            // 工具回退不改变历史，所以这里不需要 load，也不碰 History。
            const restored = files ? await Snapshot.restoreToTool({ sessionId, toolCallId }) : await Snapshot.dropTool({ sessionId, toolCallId })
            return { restored }
        }
        
/**
 * 读这条会话的运行设置：模式、自动批准、能力开关。
 * @param {{ sessionId: string }} session
 * @returns {Promise<object>} 完整设置。
 */
const readSettings = async ({ sessionId }) => {
    await readMeta(sessionId)
    return Settings.read({ sessionId })
}

/**
 * 改这条会话的运行设置，只改点名的那几项。
 *
 * 只有模式和能力开关需要重新装配 Agent（工具表和能力都建在 Agent 上），
 * 自动批准不用：审批时是现读设置的，改完下一次工具调用就按新设置走。
 * 所以自动批准可以在任务跑着的时候随时改——用户看到模型在乱改文件时，
 * 要能当场把"写入"关掉，而不是先停下来再改。
 * @param {{ sessionId: string } & object} change
 * @returns {Promise<object>} 保存后的完整设置。
 * @throws {Error} 需要换工具表或能力时任务正在跑，按冲突处理（409）。
 */
const saveSettings = async ({ sessionId, ...change }) => {
    const meta = await readMeta(sessionId)
    const current = await Settings.read({ sessionId })

    // 改的是自动批准，别的都没动——不重建，也就没有"任务在跑"这一说。
    const onlyAutoApprove = Object.keys(change).every(key => key === 'autoApprove')
    // 模式和能力换掉之后必须重建 Agent 才生效，所以这时候不能让任务在跑。
    // 这一关要在写盘之前过：被拒的改动不该留在磁盘上。
    if (!onlyAutoApprove && Store.agents.get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)

    const saved = await Settings.save({ sessionId, ...change })
    if (onlyAutoApprove) return saved
    // 什么都没变就不白重建一次，免得把正在等待的审批也一并打散。
    if (settingsEqual(current, saved)) return saved

    // 历史原样交回去，不丢消息。
    Store.agents.delete(sessionId)
    await History.load({ sessionId })
    await createAgent({ sessionId, history: History.get({ sessionId }), meta })
    return saved
}

// --- 两份设置是不是同一份 ---
// 只比结构，不做深比较——设置的形状就是普通对象套布尔值，不会更深。
const settingsEqual = (first, second) => JSON.stringify(first) === JSON.stringify(second)


    /**
     * 记过哪些工具调用，界面据此列出"可以退回到哪一步"。
     * @param {{ sessionId: string }} session
     * @returns {Promise<object[]>} 每次改过文件的工具调用，按发生顺序。
     */
    const toolChanges = async ({ sessionId }) => {
        await readMeta(sessionId)
        return Snapshot.entries({ sessionId })
    }
    
    /**
     * 这一次回退会恢复哪些文件，以及它们各自改了什么。
     * @param {{ sessionId: string, keep: (entry: object) => boolean }} scope keep 判断某条记录是否属于要保留的那一段。
     * @returns {Promise<object[]>} 会被恢复的文件；结构同 Snapshot.diff 的每一项。
     */
    const changedFiles = async ({ sessionId, keep }) => {
        const droppedPaths = new Set()
        for (const entry of Snapshot.entries({ sessionId })) {
            if (keep(entry)) continue
            for (const path of entry.paths) droppedPaths.add(path)
        }
        return (await Snapshot.diff({ sessionId })).filter(file => droppedPaths.has(file.path))
    }
    
        /**
         * 撤销最近一次回退，可以连着调用好几层，直到发新消息把可撤销的层清空。
         * @param {{ sessionId: string, files?: boolean }} target files 要和回退时传的一致。
         * @returns {Promise<object>} 撤销后的完整会话，另带 restored 是被还原的文件列表。
         */
        const redo = async ({ sessionId, files = true }) => {
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
const send = ({ sessionId, input }) => run({ sessionId, input })

const CONTINUE_PROMPT = '继续上次未完成的任务，从现有进度接着做，不要重复已经完成的内容；完成后调用结束工具。'

// 继续被中断的助手回复：内部发一条提示，但不作为用户消息保存。
const resume = ({ sessionId }) => run({ sessionId, input: CONTINUE_PROMPT, resume: true })

// --- 取一条消息里的纯文本 ---
// 继续提示可能是字符串，也可能是内容块数组，两种都要能核对。
const textOf = message => {
    if (typeof message?.content === 'string') return message.content
    return (Array.isArray(message?.content) ? message.content : [])
        .filter(part => part?.type === 'text')
        .map(part => part.text || '')
        .join('')
}

// --- 给继续提示打内部标记 ---
// agent.send 会把 input 原样追加成一条 user 消息。这里先记下发送前的最后一条，
// 发送后确认"末尾换了新消息，且内容正好是继续提示"，才给它打 internal。
// 不按位置盲目标最后一条：一旦追加没发生，被标成内部的就是用户真正发过的消息。
const tagContinuePrompt = ({ agent, previousLast }) => {
    const marker = agent.history.at(-1)                               // 发送后历史末尾应该是新追加的提示
    if (marker === previousLast) return false                         // 没有新消息，不能拿旧消息顶替
    if (marker?.role !== 'user' || textOf(marker) !== CONTINUE_PROMPT) return false // 身份和内容都要对上
    marker.internal = true                                            // 只给模型看，保存和界面都会跳过它
    return true
}

// --- 把 Agent 内存里的新消息同步到历史文件 ---
// 同一个会话的保存串成一条队：两次保存交错时会重复追加同一条消息。
const saveQueue = new Map()
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
        // 历史落盘后清掉已经写进去的 SSE 事件；后续事件仍然保留给断线重连。
        await History.save({ sessionId })
    })
    saveQueue.set(sessionId, task)
    // 队列只负责串行；失败要留下是哪个会话、什么原因，不能静默吞掉。
    task.finally(() => { if (saveQueue.get(sessionId) === task) saveQueue.delete(sessionId) })
        .catch(error => console.error(`[session ${sessionId}] 保存历史失败：${error.message}`))
    return task
}

const run = async ({ sessionId, input, resume = false }) => {
    // 用户输入在这里检查一次：去掉首尾空格后不能为空。
    if (typeof input !== 'string' || !input.trim()) throw fail(400, 'input must be a non-empty string')
    const meta = await readMeta(sessionId)
    const agent = await getAgent({ sessionId, meta })
    if (resume && agent.running) throw fail(409, `Agent is already running: ${sessionId}`)
    if (resume && [...agent.history].reverse().find(message => !message.internal)?.role !== 'assistant') {
        throw fail(409, '最后一条消息不是助手回复，不能继续')
    }

    // 新消息代表新的时间线，之前的回退不能再撤销了。
    await Snapshot.clearUndo({ sessionId })
    // 自动批准的计数也跟着归零：用户刚发了新指令，是新的开始。
    Store.autoApproved.set(sessionId, 0)
    // 重复调用的判断也重新开始，上一轮的连续重试不该影响这一轮。
    Store.recentCalls.delete(sessionId)

    // 这一轮用哪份配置：主模型加上用户为压缩单独指定的那个（如果配了）。
    const settings = await Settings.read({ sessionId })
    // 发消息前重读规则，用户刚改过 AGENTS.md 或模式专属规则也能在这一轮生效。
    await Rules.load({ mode: settings.mode })

    // Agent 运行过程产生的每一段都通过 SSE 推给前端，前端只认事件类型。
    const previousLast = agent.history.at(-1)                         // 发送前的末尾，用来认出刚追加的继续提示
    const task = agent.send({
        input: input.trim(),
        config: Config.resolve({ provider: meta.provider, model: meta.model, uses: settings.uses }),
        callbacks: {
            onStart: () => SSE.send({ id: sessionId, data: { type: resume ? 'agent-resume' : 'agent-start' } }),
            onLLMStart: request => SSE.send({ id: sessionId, data: { type: 'llm-start', ...request } }),
            onLLMFinish: result => SSE.send({ id: sessionId, data: { type: 'llm-finish', ...result } }),
            onLLMEvent: event => SSE.send({ id: sessionId, data: event }),
            onRetry: info => SSE.send({ id: sessionId, data: { type: 'retry', ...info } }),
            onToolCall: call => SSE.send({ id: sessionId, data: { ...call, type: 'tool-call' } }),
            onToolOutput: output => SSE.send({ id: sessionId, data: { ...output, type: 'tool-output' } }),
            onToolResult: result => {
                // execute_command 改了哪些文件只有跑完才知道；和命令前的清单对比后记一次检查点。
                const toolCallId = result.toolCallId || result.callID
                if (canonical(result.toolName) === 'execute_command' && toolCallId) {
                    Snapshot.endShell({ sessionId, toolCallId }).catch(() => {})
                }
                SSE.send({ id: sessionId, data: { ...result, type: 'tool-result' } })
            },
            // 每完成一步就落盘；关掉软件或进程被杀时，已完成的进度还在。
            // 落盘同时清掉已包含的事件，断线重连会先读历史，不会重复播放已经显示的内容。
            onStep: () => { void syncHistory({ sessionId, agent }).catch(() => {}) },
            onCompact: event => SSE.send({ id: sessionId, data: event }),
            // 快照同时记下"哪条用户消息"和"哪次工具调用"，所以既能退回整轮对话，
            // 也能只退回某一个工具调用。messageId 必须在这时候才取：Agent 内部要先 await
            // 停止上一个任务，才会把用户消息写进历史，send 一返回就取会取到上一轮的那条。
            // 这里已经是跑工具的阶段，消息早就进去了。也不要自己造一个 id —— 那样和历史里
            // 那条对不上，回退会找不到快照。
            onPermission: ({ toolCallId, toolName, input: toolInput, signal }) => Approval.check({
                sessionId,
                messageId: agent.history.findLast(message => message.role === 'user' && !message.internal)?.id,
                toolCallId,
                toolName,
                input: toolInput,
                signal,
            }),
        },
    })
    // 先挂上收尾处理：即使下面因为继续提示不对而拒绝这次请求，任务 Promise 也不会无人接收。
    // 任务结束后把这一轮新增的消息写进历史文件，再通知前端刷新。
    task.then(async result => {
        await syncHistory({ sessionId, agent })                       // 最终保存：历史稳定，清掉 SSE 缓存
        // 标题在任务成功之后才起：这一轮有没有跑通，直接决定标题该不该花这次请求。
        if (!resume) await titleFor({ sessionId, meta, settings, agent })
        // 缓存清完再通知，前端刷新时读到的是完整历史，不会和补发事件打架。
        await SSE.send({ id: sessionId, data: { type: 'agent-finish', ...result } })
    }).catch(async error => {
        // 失败和中断也要留下已经产生的进度，用户才能从断点继续。
        await syncHistory({ sessionId, agent }).catch(() => {})
        await SSE.send({ id: sessionId, data: { type: 'agent-finish', error: error.message } })
    })
    // 继续提示由 agent.send 追加到历史末尾；身份核对不上时绝不标记，停掉这一轮并给出明确原因。
    if (resume && !tagContinuePrompt({ agent, previousLast })) {
        await agent.stop().catch(() => {})
        throw fail(500, '继续提示没有出现在历史末尾，已停止本次继续')
    }
    // 先把用户消息或恢复前的进度落盘；第一轮模型还没返回就关掉软件也不丢这一轮。
    // 保存后清掉已经包含在历史里的事件，断线重连会从历史接着走。
    void syncHistory({ sessionId, agent }).catch(() => {})
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
    const fresh = await readMeta(sessionId)
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
    await writeMeta(fresh)
    // 告诉界面新标题是什么，免得侧边栏要等下一次刷新才变。
    await SSE.send({ id: sessionId, data: { type: 'title', title } })
}

// --- 停止 Agent 任务 ---
const stop = async ({ sessionId }) => {
    const agent = Store.agents.get(sessionId)
    if (!agent) return { ok: false }
    const result = await agent.stop()
    // 中断也把已经产生的消息落盘，刷新后还能看到进度并从断点继续。
    // 停止是这一轮的最终状态，保存后清掉 SSE 缓存。
    let saved = true
    try {
        await syncHistory({ sessionId, agent })
    } catch {
        saved = false
        // stop 的接口约定只有 { ok }，保存失败不能塞进返回值改变契约。
        // syncHistory 已经把"哪个会话、什么原因"写进日志，界面停止后会重新读历史。
    }
    // 只有最终保存成功、缓存也清完，才通知前端这一轮真的结束。
    if (result.ok && saved) await SSE.send({ id: sessionId, data: { type: 'agent-finish' } })
    return result
}

// --- 处理工具审批 ---
const decide = ({ sessionId, toolCallId, decision }) => Approval.decide({ sessionId, toolCallId, decision })

// --- 统计会话数量 ---
const count = () => Store.sessions.size

// --- 统计正在运行的任务 ---
const runningCount = () => [...Store.agents.values()].filter(agent => agent.running).length

export default {
    prepare, list, create, read, rename, remove, setModel, fork,
    rollback, rollbackPreview, rollbackTool, redo,
    readSettings, saveSettings,
    changes, toolChanges, compact, send, resume, stop, decide, count, runningCount,
}
