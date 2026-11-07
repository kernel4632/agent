/*
 * 会话历史：会话资料的读写、消息追加、消息回退和撤销。
 *
 * store.sessions 是内存里的唯一来源；磁盘上每条会话一个目录：
 *   meta.json      标题、当前目录、模型、时间
 *   history.json   消息和回退栈
 *   settings.json  思考强度
 * 消息回退只动这里的消息，不碰磁盘上的文件；文件恢复是文件工具自己的事。
 *
 * 调用示例：
 *   const session = await History.load('session-1')
 *   const record = await History.add({ sessionId: 'session-1', message })
 *   await History.rollback({ sessionId: 'session-1', messageId: record.messageId })
 *   await History.save('session-1')
 */

import { mkdir, readdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically'
import { nanoid } from 'nanoid'
import store from '../store.js'
import Path from '../utils/path.js'
import Scratch from '../utils/scratch.js'
import SSE from '../utils/sse.js'
import fail from '../utils/fail.js'

// meta.json 里的会话资料；读写两边都用同一份字段表，加上运行标记也不会互相走样。
const META_FIELDS = ['id', 'title', 'cwd', 'temporary', 'model', 'createdAt', 'updatedAt', 'running']
const metaOf = session => {
    const meta = {
        id: session.id,
        title: session.title,
        cwd: session.cwd,
        ...(session.temporary ? { temporary: true } : {}),
        model: session.model,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        ...(session.running ? { running: true } : {}),
    }
    for (const key of Object.keys(meta)) if (meta[key] === undefined) delete meta[key]
    return meta
}

// --- 从磁盘读一条会话进内存；只认当前形状 ---
// 旧版本/测试可能只留下 meta.json，历史或设置文件缺失时按空会话恢复，
// 否则会话列表能看到、点进去却报 ENOENT，删除也会被同一步挡住。
const readSessionFile = async (file, fallback, label) => {
    try {
        return await Bun.file(file).json()
    } catch (error) {
        if (error?.code !== 'ENOENT' && !String(error?.message || '').includes('ENOENT')) {
            console.warn(`[session] ${label} 读取失败，按空数据恢复：${error.message}`)
        }
        return fallback
    }
}

const load = async sessionId => {
    if (store.sessions[sessionId]) return store.sessions[sessionId]

    const metaFile = Bun.file(Path.meta(sessionId))
    if (!await metaFile.exists()) throw fail(404, `Session not found: ${sessionId}`)
    const meta = await metaFile.json()                                // 当前形状的会话资料
    const temporary = meta.temporary === true
    if (temporary) await Scratch.ensure(meta.cwd, true)
    const rawHistory = await readSessionFile(Path.history(sessionId), { messages: [], redo: [] }, 'history.json')
    const settings = await readSessionFile(Path.settings(sessionId), { reasoning: 'auto' }, 'settings.json')
    const history = rawHistory && Array.isArray(rawHistory.messages)
        ? { messages: rawHistory.messages, redo: Array.isArray(rawHistory.redo) ? rawHistory.redo : [] }
        : { messages: [], redo: [] }

    const session = {
        id: meta.id,
        title: meta.title,
        cwd: meta.cwd,
        temporary,
        model: meta.model,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        running: meta.running === true,
        history,
        settings,
    }

    store.sessions[sessionId] = session
    return session
}

// --- 新建一条会话 ---
const create = async ({ title, cwd, temporary, provider, model, settings }) => {
    const id = nanoid()
    const now = Date.now()
    const session = {
        id,
        title,
        cwd: cwd || process.cwd(),
        temporary: temporary === true,
        model: { provider: provider || '', model: model || '' },
        createdAt: now,
        updatedAt: now,
        running: false,
        history: { messages: [], redo: [] },
        settings,
    }
    store.sessions[id] = session
    await save(id)
    return session
}

// --- 保存一条会话（元数据、历史、设置） ---
const save = async sessionId => {
    const session = store.sessions[sessionId]
    if (!session) throw new Error(`Session not loaded: ${sessionId}`)
    await mkdir(Path.session(sessionId), { recursive: true })

    // 原子写入，避免程序中断留下半份 JSON。
    // running 记在 meta 上：崩溃或重启后进程内的运行状态已经丢了，磁盘上这一位
    // 是重启后判断“这个会话被打断了”的唯一依据。
    await writeFile(Path.meta(sessionId), JSON.stringify(metaOf(session), null, 2))
    await writeFile(Path.history(sessionId), JSON.stringify(session.history, null, 2))
    await writeFile(Path.settings(sessionId), JSON.stringify(session.settings, null, 2))

    // 历史落盘后清掉已经包含的事件；断线重连会先读历史，再接收新事件。
    await SSE.reset({ id: sessionId })
    return session
}

// --- 只保存设置 ---
const saveSettings = async ({ sessionId, settings }) => {
    const session = store.sessions[sessionId]
    if (!session) throw new Error(`Session not loaded: ${sessionId}`)
    session.settings = settings
    session.updatedAt = Date.now()
    await mkdir(Path.session(sessionId), { recursive: true })
    await writeFile(Path.settings(sessionId), JSON.stringify(settings, null, 2))
    return settings
}

// --- 列出磁盘上的全部会话，最近用过的排前面 ---
const list = async ({ search = '' } = {}) => {
    const entries = await readdir(Path.sessions()).catch(() => [])
    const sessions = []

    for (const entry of entries) {
        const file = Bun.file(Path.meta(entry))
        if (!await file.exists()) continue
        const meta = await file.json()
        const provider = meta.model.provider
        const model = meta.model.model
        if (search && !`${meta.title} ${model}`.toLowerCase().includes(search.toLowerCase())) continue
        sessions.push({
            id: meta.id,
            title: meta.title,
            cwd: meta.cwd,
            temporary: meta.temporary === true,
            provider,
            model,
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt,
        })
    }

    sessions.sort((first, second) => (second.updatedAt || 0) - (first.updatedAt || 0))
    return sessions
}

// --- 往历史末尾追加一条消息 ---
const add = async ({ sessionId, message }) => {
    const session = store.sessions[sessionId]
    if (!session) throw new Error(`History not loaded: ${sessionId}`)
    const record = { messageId: nanoid(), message }

    session.history.messages.push(record)
    session.history.redo = [] // 新消息代表新的时间线，之前被回退的内容不能再恢复。
    session.updatedAt = Date.now()
    return record
}

// --- 回退到这条消息之前；不管退哪条消息，它和它之后的全部都会消失 ---
const rollback = async ({ sessionId, messageId }) => {
    const session = store.sessions[sessionId]
    const index = session.history.messages.findIndex(record => record.messageId === messageId)
    if (index < 0) throw fail(404, `Message not found: ${messageId}`)

    session.history.redo.push(session.history.messages.splice(index))
    session.updatedAt = Date.now()
}

// --- 撤销最近一次回退 ---
const redo = async ({ sessionId }) => {
    const session = store.sessions[sessionId]
    const records = session.history.redo.pop()
    if (records) session.history.messages.push(...records)
    session.updatedAt = Date.now()
}

// --- 任务开跑 / 结束时更新运行标记 ---
// 这两个入口故意只改内存：开跑时落盘由 startRun 的 saveMeta 负责，收尾时的落盘也
// 用 saveMeta 补一笔（syncHistory 发生在 finishRun 之前，会把 true 一起写下去）。
// 崩溃时最多留下一个“其实已结束”的脏标记，恢复时能识别。
const setRunning = (sessionId, running) => {
    const session = store.sessions[sessionId]
    if (!session) return
    session.running = Boolean(running)
    if (running) session.updatedAt = Date.now()
}

// --- 只把 meta 写回磁盘：运行标记的变化用，不动历史也不清 SSE 缓存 ---
const saveMeta = async sessionId => {
    const session = store.sessions[sessionId]
    if (!session) return
    await mkdir(Path.session(sessionId), { recursive: true })
    await writeFile(Path.meta(sessionId), JSON.stringify(metaOf(session), null, 2))
}

// --- 还有几次回退可以撤销 ---
const redoCount = ({ sessionId }) => store.sessions[sessionId]?.history.redo.length || 0

// --- 回退后还留着哪些消息块 id；文件恢复靠它判断恢复范围 ---
const idsBefore = ({ sessionId, messageId }) => {
    const session = store.sessions[sessionId]
    const index = session.history.messages.findIndex(record => record.messageId === messageId)
    if (index < 0) throw fail(404, `Message not found: ${messageId}`)
    return session.history.messages.slice(0, index).map(record => record.message.id)
}

// --- 读取当前历史：把 messageId 摊回消息对象上 ---
const get = ({ sessionId }) => {
    const session = store.sessions[sessionId]
    if (!session) throw new Error(`History not loaded: ${sessionId}`)
    return session.history.messages.map(({ messageId, message }) => ({ messageId, ...message }))
}

// --- 内存里加载了多少条会话；健康检查用 ---
const count = () => Object.keys(store.sessions).length

// --- 磁盘上还带着运行标记的会话：重启后从这里挑出要自动续跑的 ---
const runningOnDisk = async () => {
    const sessions = []
    for (const entry of await readdir(Path.sessions()).catch(() => [])) {
        const meta = await Bun.file(Path.meta(entry)).json().catch(() => null)
        if (meta?.running === true) sessions.push({ id: meta.id, title: meta.title, updatedAt: meta.updatedAt })
    }
    return sessions
}

// --- 会话删除后丢掉内存里的那一份 ---
const remove = ({ sessionId }) => {
    delete store.sessions[sessionId]
}

// --- 测试用：清空全部会话 ---
const clear = () => {
    for (const id of Object.keys(store.sessions)) delete store.sessions[id]
}

// --- 删除会话目录；会话不存在时也当作已删除 ---
const destroy = async sessionId => {
    remove({ sessionId })
    await rm(Path.session(sessionId), { recursive: true, force: true })
}

// --- 建出数据目录；启动时调用一次 ---
const prepare = async () => {
    await mkdir(dirname(Path.config()), { recursive: true })
    await mkdir(Path.tools(), { recursive: true })
}

export default {
    load, create, save, saveSettings, list,
    add, rollback, redo, redoCount, idsBefore, get,
    count, remove, clear, destroy, prepare, setRunning, saveMeta, runningOnDisk,
}
