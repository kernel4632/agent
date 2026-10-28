/*
 * 会话指令：创建、列表、读取、分支、改名、删除、目录、设置、模型和回退。
 *
 * 会话是唯一的长期容器；cwd 只是它的一个属性，换目录不需要新建会话。
 * 消息回退由 features/rollback.js 负责；文件和预览由 tools/file.js 的快照能力负责，
 * 这一层只把两边按用户看到的顺序串起来。
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
import Rollback from '../features/rollback.js'
import Title from '../features/title.js'
import Tool from '../features/tool.js'
import SSE from '../utils/sse.js'
import fail from '../utils/fail.js'

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
    const chosen = namedModel || (typeof own === 'string' ? own : own?.id || '')
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
    const session = await History.create({
        title: clean,
        cwd: await folder(cwd || process.cwd()),
        provider: chosen.provider,
        model: chosen.model,
        settings: Agent.defaultSettings(),
    })
    await Agent.create({ sessionId: session.id })
    return { sessionId: session.id }
}

// --- 从现有会话分出一个新分支 ---
const fork = async ({ sessionId, title, messageId }) => {
    const source = await History.load(sessionId)
    if (Agent.runtime().get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)

    const messages = History.get({ sessionId })
    let kept = messages
    if (messageId) {
        const index = messages.findIndex(message => message.messageId === messageId)
        if (index < 0) throw fail(404, `Message not found: ${messageId}`)
        kept = messages.slice(0, index + 1)
    }

    const clean = typeof title === 'string' && title.trim() ? title.trim() : `${source.title}（分支）`
    const branch = await History.create({
        title: clean.slice(0, 120),
        cwd: source.cwd,
        provider: source.model.provider,
        model: source.model.model,
        settings: await Agent.readSettings(sessionId),
    })
    // 历史复制到新目录，消息重新编号，分支之后的操作不会影响原会话。
    for (const { messageId: ignored, ...message } of kept) await History.add({ sessionId: branch.id, message })
    await History.save(branch.id)
    await Agent.create({ sessionId: branch.id })
    return { sessionId: branch.id }
}

// --- 读取一条会话 ---
const read = async ({ sessionId }) => {
    const session = await History.load(sessionId)
    const agent = Agent.runtime().get(sessionId)
    const visible = history => history.filter(message => !message.internal)
    const running = Boolean(agent?.running)

    let history
    if (running) {
        history = visible(agent.history)
    } else {
        history = visible(History.get({ sessionId }))
        if (agent) agent.history = history
        else await Agent.create({ sessionId })
    }

    return {
        id: session.id,
        title: session.title,
        cwd: session.cwd,
        provider: session.model.provider,
        model: session.model.model,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        history,
        todos: latestTodos(history),
        running,
        pending: Approval.pending(sessionId),
        settings: await Agent.readSettings(sessionId),
        undoable: History.redoCount({ sessionId }),
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
    if (Agent.runtime().get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)
    const chosen = typeof provider === 'string' && provider.trim() ? provider.trim() : session.model.provider
    const name = typeof model === 'string' && model.trim() ? model.trim() : session.model.model
    if (!chosen || !name) throw fail(400, 'provider and model must be non-empty strings')
    Agent.connection({ provider: chosen, model: name })

    session.model = { provider: chosen, model: name }
    session.updatedAt = Date.now()
    await History.save(sessionId)
    Agent.invalidate(sessionId)
    await Agent.create({ sessionId })
    return { ...session, provider: chosen, model: name }
}

// --- 按后续对话重新生成标题 ---
const generateTitle = async ({ sessionId }) => {
    const session = await History.load(sessionId)
    const target = Agent.configured(store.config.models?.title) || session.model
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
    session.cwd = await folder(cwd)
    session.updatedAt = Date.now()
    await History.save(sessionId)
    return { id: session.id, cwd: session.cwd }
}

// --- 删除会话 ---
const remove = async ({ sessionId }) => {
    await History.load(sessionId)
    if (Agent.runtime().get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)

    Agent.invalidate(sessionId)
    Approval.remove(sessionId)
    await Tool.remove({ sessionId })
    await SSE.close({ id: sessionId })
    await History.destroy(sessionId)
    return { ok: true }
}

const readSettings = async ({ sessionId }) => {
    await History.load(sessionId)
    return Agent.readSettings(sessionId)
}

const saveSettings = async ({ sessionId, ...change }) => Agent.saveSettings({ sessionId, ...change })

// --- 手动压缩 ---
const compact = async ({ sessionId }) => {
    const content = await Compact.run({ sessionId })
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
    const plan = Rollback.preview({ sessionId, messageId })
    const entries = await Tool.entries({ sessionId })
    const dropped = new Set()
    for (const entry of entries) {
        if (plan.keep.includes(entry.messageId)) continue
        for (const path of entry.paths) dropped.add(path)
    }
    const files = (await Tool.diff({ sessionId })).filter(file => dropped.has(file.path))
    return { messages: plan.messages, files }
}

// --- 消息和文件一起回退，也可以只退消息 ---
const rollback = async ({ sessionId, messageId, files = true }) => {
    await History.load(sessionId)
    if (Agent.runtime().get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)

    // 先算出回退后还留哪些消息块，再恢复文件；文件失败时消息保持原样。
    const plan = Rollback.preview({ sessionId, messageId })
    const restored = files ? await Tool.restoreMessage({ sessionId, keepMessages: plan.keep }) : []
    await Rollback.messages({ sessionId, messageId })
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
    await Rollback.undo({ sessionId })
    return { ...await read({ sessionId }), restored }
}

// =======================================================================
//  兼容旧界面的目录信息：它不是工作区，只是进程当前所在目录
// =======================================================================

const FILE_LIMIT = 200
const SKIP = ['node_modules', '.git', 'dist', 'build', 'out', 'coverage']

const filesIn = async path => {
    const found = []
    for await (const entry of new Bun.Glob('**/*').scan({ cwd: path, onlyFiles: true, dot: false })) {
        const normalized = entry.replace(/\\/g, '/')
        if (normalized.split('/').some(part => SKIP.includes(part))) continue
        if (normalized.split('/').length > 3) continue
        found.push(normalized)
        if (found.length >= FILE_LIMIT) break
    }
    return found
}

const git = async (args, cwd) => {
    const process = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, , exitCode] = await Promise.all([process.stdout.text(), process.stderr.text(), process.exited])
    return exitCode === 0 ? stdout.trim() : ''
}

const gitStatus = async path => {
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], path)
    if (!branch) return null
    const lines = (await git(['status', '--porcelain'], path)).split('\n').filter(Boolean)
    const counts = { modified: 0, added: 0, deleted: 0, untracked: 0 }
    for (const line of lines) {
        const code = line.slice(0, 2)
        if (code === '??') counts.untracked += 1
        else if (code.includes('D')) counts.deleted += 1
        else if (code.includes('A')) counts.added += 1
        else counts.modified += 1
    }
    return { branch, changed: lines.length, ...counts }
}

const workspace = async () => {
    const path = process.cwd()
    return { path, files: await filesIn(path), git: await gitStatus(path) }
}

const workspaceStatus = async ({ path = process.cwd() } = {}) => gitStatus(path)

// --- 统计会话数量 ---
const count = () => History.count()

// --- 统计正在运行的任务 ---
const runningCount = () => Agent.runningCount()

export default {
    create, fork, list: History.list, read, rename, setModel, setCwd, generateTitle, remove,
    readSettings, saveSettings, compact,
    changes, toolChanges, rollbackPreview, rollback, rollbackTool, redo,
    workspace, workspaceStatus, count, runningCount,
}
