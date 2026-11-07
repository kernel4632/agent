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
import { dirname, join } from 'node:path'
import { writeFile } from 'atomically'
import { nanoid } from 'nanoid'
import store from '../store.js'
import Path from '../utils/path.js'
import Scratch from '../utils/scratch.js'
import SSE from '../utils/sse.js'
import fail from '../utils/fail.js'

// 活跃文件只保留最近这么多条消息，更早的封存到 history/ 分块里。
// 这样每轮保存只重写一个大小有上限的 history.json，而不是整段会话。
const ACTIVE_MESSAGES = 400
const ARCHIVE_BATCH = 200

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

// --- 读取封存的历史分块；分块只追加，加载时按索引顺序拼回完整历史 ---
const readArchives = async sessionId => {
    const index = await readSessionFile(Path.historyIndex(sessionId), null, 'history-index.json')
    if (!index || !Array.isArray(index.archives) || !index.archives.length) {
        return { records: [], archives: [] }
    }
    const records = []
    for (const archive of index.archives) {
        const file = join(Path.historyArchives(sessionId), archive.file)
        const chunk = await readSessionFile(file, null, archive.file)
        if (!chunk || !Array.isArray(chunk.messages)) {
            throw fail(500, `会话历史分块丢失或损坏：${archive.file}`)
        }
        records.push(...chunk.messages)
    }
    return { records, archives: index.archives }
}

const load = async sessionId => {
    if (store.sessions[sessionId]) return store.sessions[sessionId]

    const metaFile = Bun.file(Path.meta(sessionId))
    if (!await metaFile.exists()) throw fail(404, `Session not found: ${sessionId}`)
    const meta = await metaFile.json()                                // 当前形状的会话资料
    const temporary = meta.temporary === true
    if (temporary) await Scratch.ensure(meta.cwd, true)
    const rawHistory = await readSessionFile(Path.history(sessionId), { messages: [], redo: [] }, 'history.json')
    const archived = await readArchives(sessionId)
    const settings = await readSessionFile(Path.settings(sessionId), { reasoning: 'auto' }, 'settings.json')
    const active = rawHistory && Array.isArray(rawHistory.messages) ? rawHistory.messages : []
    // index 先于活跃文件落盘：极端崩溃时 active 可能还是旧的完整历史，
    // 和分块重叠。按 messageId 去重，保留第一次出现的顺序。
    const seen = new Set()
    const messages = []
    for (const record of [...archived.records, ...active]) {
        const id = record?.messageId
        if (id && seen.has(id)) continue
        if (id) seen.add(id)
        messages.push(record)
    }
    const history = {
        messages,
        redo: Array.isArray(rawHistory?.redo) ? rawHistory.redo : [],
        activeStart: archived.records.length,
        archives: archived.archives,
    }

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
        history: { messages: [], redo: [], activeStart: 0, archives: [] },
        settings,
    }
    store.sessions[id] = session
    await save(id)
    return session
}

// --- 把超出活跃窗口的消息封存到新分块；分块一旦写完就不再修改 ---
const archiveActive = async session => {
    const messages = session.history.messages
    if (!Number.isInteger(session.history.activeStart)) session.history.activeStart = 0
    if (!Array.isArray(session.history.archives)) session.history.archives = []
    let activeStart = session.history.activeStart
    const lastArchived = session.history.archives.at(-1)?.last
    const prefixMatches = activeStart === 0
        || (activeStart <= messages.length && messages[activeStart - 1]?.messageId === lastArchived)
    if (!prefixMatches) {
        // 回退跨过了封存边界：旧分块里的消息已经不属于当前时间线，整体重建。
        await rm(Path.historyArchives(session.id), { recursive: true, force: true })
        session.history.archives = []
        activeStart = 0
    }
    await mkdir(Path.historyArchives(session.id), { recursive: true })
    while (messages.length - activeStart > ACTIVE_MESSAGES) {
        const take = Math.min(ARCHIVE_BATCH, messages.length - activeStart - ACTIVE_MESSAGES)
        const batch = messages.slice(activeStart, activeStart + take)
        const file = `${String(session.history.archives.length + 1).padStart(6, '0')}.json`
        await writeFile(join(Path.historyArchives(session.id), file), JSON.stringify({ messages: batch }, null, 2))
        session.history.archives.push({
            file,
            count: batch.length,
            first: batch[0]?.messageId || '',
            last: batch.at(-1)?.messageId || '',
        })
        activeStart += take
    }
    session.history.activeStart = activeStart
}

// --- 保存一条会话（元数据、活跃历史、设置） ---
const save = async sessionId => {
    const session = store.sessions[sessionId]
    if (!session) throw new Error(`Session not loaded: ${sessionId}`)
    await mkdir(Path.session(sessionId), { recursive: true })

    await archiveActive(session)
    const active = session.history.messages.slice(session.history.activeStart)
    await writeFile(Path.historyIndex(sessionId), JSON.stringify({
        activeStart: session.history.activeStart,
        archives: session.history.archives,
    }, null, 2))

    // 原子写入，避免程序中断留下半份 JSON。
    // running 记在 meta 上：崩溃或重启后进程内的运行状态已经丢了，磁盘上这一位
    // 是重启后判断“这个会话被打断了”的唯一依据。
    await writeFile(Path.meta(sessionId), JSON.stringify(metaOf(session), null, 2))
    await writeFile(Path.history(sessionId), JSON.stringify({ messages: active, redo: session.history.redo }, null, 2))
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

// --- 历史分页：before 是消息下标；默认取最后一页 ---
const page = async ({ sessionId, before, limit = 200 }) => {
    const session = await load(sessionId)
    const messages = get({ sessionId })
    const size = Math.min(500, Math.max(1, Math.floor(Number(limit) || 200)))
    const end = Number.isInteger(before) ? Math.min(messages.length, Math.max(0, before)) : messages.length
    const start = Math.max(0, end - size)
    return {
        messages: messages.slice(start, end),
        start,
        end,
        total: messages.length,
        hasMore: start > 0,
    }
}

const plainText = message => {
    const parts = Array.isArray(message?.content) ? message.content : []
    const text = parts.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join(' ')
    return String(text || (typeof message?.content === 'string' ? message.content : '')).replace(/\s+/g, ' ').trim()
}

const outputText = output => {
    if (typeof output === 'string') return output
    if (typeof output?.value === 'string') return output.value
    if (typeof output?.value?.text === 'string') return output.value.text
    if (typeof output?.text === 'string') return output.text
    return ''
}

// 和右侧定位条的回答预览保持一致：优先取结束工具的最终输出。
const answerText = message => {
    const parts = Array.isArray(message?.content) ? message.content : []
    for (const part of parts) {
        if (part?.type !== 'tool-result') continue
        if (!['attempt_completion', 'ask_followup_question'].includes(part.toolName)) continue
        const text = outputText(part.output)
        if (text) return String(text).replace(/\s+/g, ' ').trim()
    }
    return ''
}

// --- 整个会话的轮次大纲：只带预览，不带正文 ---
const outline = async sessionId => {
    await load(sessionId)
    const turns = []
    let current = null
    for (const [index, record] of store.sessions[sessionId].history.messages.entries()) {
        const message = record.message
        if (!message || message.compact) continue
        if (message.role === 'user') {
            const prompt = plainText(message)
            current = {
                id: record.messageId,
                index,
                role: 'user',
                prompt: prompt.slice(0, 120),
                response: '',
                length: prompt.length,
            }
            turns.push(current)
        } else if (message.role === 'assistant') {
            const text = answerText(message)
            if (current && !current.response) {
                current.response = text.slice(0, 240)
                current.length = (current.length || 0) + text.length
            } else if (!current) {
                current = {
                    id: record.messageId,
                    index,
                    role: 'assistant',
                    prompt: '',
                    response: text.slice(0, 240),
                    length: text.length,
                }
                turns.push(current)
            }
        }
    }
    return { turns, totalMessages: store.sessions[sessionId].history.messages.length }
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
    add, rollback, redo, redoCount, idsBefore, get, page, outline,
    count, remove, clear, destroy, prepare, setRunning, saveMeta, runningOnDisk,
}
