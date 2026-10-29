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
import SSE from '../utils/sse.js'
import fail from '../utils/fail.js'

// --- 把磁盘上的旧形状收成当前形状 ---
const normalize = (session, id) => {
    const model = session.model && typeof session.model === 'object'
        ? { provider: session.model.provider || '', model: session.model.model || '' }
        : { provider: session.provider || '', model: session.model || '' }
    const history = session.history && Array.isArray(session.history.messages) ? session.history : { messages: [], redo: [] }
    history.redo ||= []
    // 设置里只保留当前认识的字段；旧版的能力开关、按会话配模型和标题开关不再进入内存。
    const settings = session.settings && typeof session.settings === 'object' ? session.settings : {}
    delete settings.agent
    delete settings.mode
    delete settings.capabilities
    delete settings.uses
    delete settings.autoTitle
    delete settings.compactThreshold
    return {
        id: session.id || id,
        title: session.title || '新对话',
        cwd: session.cwd || process.cwd(),
        model,
        createdAt: session.createdAt || Date.now(),
        updatedAt: session.updatedAt || session.createdAt || Date.now(),
        history,
        settings,
    }
}

// --- 从磁盘读一条会话进内存 ---
const load = async sessionId => {
    if (store.sessions[sessionId]) return store.sessions[sessionId]

    const metaFile = Bun.file(Path.meta(sessionId))
    if (!await metaFile.exists()) throw fail(404, `Session not found: ${sessionId}`)
    const meta = await metaFile.json()

    const historyFile = Bun.file(Path.history(sessionId))
    const settingsFile = Bun.file(Path.settings(sessionId))
    const session = normalize({
        ...meta,
        history: await historyFile.exists() ? await historyFile.json() : { messages: [], redo: [] },
        settings: await settingsFile.exists() ? await settingsFile.json() : {},
    }, sessionId)

    store.sessions[sessionId] = session
    return session
}

// --- 新建一条会话 ---
const create = async ({ title, cwd, provider, model, settings }) => {
    const id = nanoid()
    const now = Date.now()
    const session = {
        id,
        title,
        cwd: cwd || process.cwd(),
        model: { provider: provider || '', model: model || '' },
        createdAt: now,
        updatedAt: now,
        history: { messages: [], redo: [] },
        settings: settings || {},
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
    await writeFile(Path.meta(sessionId), JSON.stringify({
        id: session.id,
        title: session.title,
        cwd: session.cwd,
        model: session.model,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
    }, null, 2))
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
        const provider = meta.model?.provider ?? meta.provider ?? ''
        const model = meta.model?.model ?? meta.model ?? ''
        if (search && !`${meta.title} ${model}`.toLowerCase().includes(search.toLowerCase())) continue
        sessions.push({
            id: meta.id || entry,
            title: meta.title,
            cwd: meta.cwd || process.cwd(),
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

// --- 回退到这条消息之前 ---
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

// --- 兼容旧调用：把会话目录的父目录建出来 ---
const prepare = async () => {
    await mkdir(dirname(Path.config()), { recursive: true })
    await mkdir(Path.tools(), { recursive: true })
}

export default {
    load, create, save, saveSettings, list,
    add, rollback, redo, redoCount, idsBefore, get,
    count, remove, clear, destroy, prepare,
}
