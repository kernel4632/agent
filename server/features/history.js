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

import { appendFile, mkdir, readdir, rm, truncate } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createReadStream } from 'node:fs'
import { writeFile } from 'atomically'
import { nanoid } from 'nanoid'
import store from '../store.js'
import Path from '../utils/path.js'
import Scratch from '../utils/scratch.js'
import SSE from '../utils/sse.js'
import fail from '../utils/fail.js'

// 历史以 JSONL 追加：正常保存不重写旧行，只有回退/迁移才整份重写。

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
        return { records: [], archives: [], format: index?.format || 0 }
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
    return { records, archives: index.archives, format: index.format || 0 }
}

// --- 读取 JSONL：逐行流式扫描，不把整份文件当 JSON 解析 ---
const readLog = async sessionId => {
    const records = []
    const offsets = []
    let offset = 0
    let buffer = Buffer.alloc(0)
    const stream = createReadStream(Path.historyLog(sessionId))
    try {
        for await (const chunk of stream) {
            buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk
            let lineEnd = buffer.indexOf(10)
            while (lineEnd >= 0) {
                const line = buffer.subarray(0, lineEnd)
                buffer = buffer.subarray(lineEnd + 1)
                if (line.length) {
                    try {
                        records.push(JSON.parse(line.toString('utf8')))
                        offsets.push(offset)
                    } catch {
                        // 崩溃留下的最后半行不参与读取，下一次保存会把它截掉。
                        return { records, offsets, size: offset }
                    }
                }
                offset += lineEnd + 1
                lineEnd = buffer.indexOf(10)
            }
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        return { records: [], offsets: [], size: 0, missing: true }
    }
    return { records, offsets, size: offset }
}

// --- 旧版 history.json + 分块迁移读取；迁完一次后只走 JSONL ---
const readLegacy = async sessionId => {
    const rawHistory = await readSessionFile(Path.history(sessionId), { messages: [], redo: [] }, 'history.json')
    const archived = await readArchives(sessionId)
    const active = rawHistory && Array.isArray(rawHistory.messages) ? rawHistory.messages : []
    const seen = new Set()
    const messages = []
    for (const record of [...archived.records, ...active]) {
        const id = record?.messageId
        if (id && seen.has(id)) continue
        if (id) seen.add(id)
        messages.push(record)
    }
    return { records: messages, offsets: [], size: 0, legacy: true, redo: rawHistory?.redo || [] }
}

const loadLog = async sessionId => {
    if (await Bun.file(Path.historyLog(sessionId)).exists()) return readLog(sessionId)
    if (await Bun.file(Path.history(sessionId)).exists()) return readLegacy(sessionId)
    return { records: [], offsets: [], size: 0, legacy: false, redo: [] }
}

const load = async sessionId => {
    if (store.sessions[sessionId]) return store.sessions[sessionId]

    const metaFile = Bun.file(Path.meta(sessionId))
    if (!await metaFile.exists()) throw fail(404, `Session not found: ${sessionId}`)
    const meta = await metaFile.json()                                // 当前形状的会话资料
    const temporary = meta.temporary === true
    if (temporary) await Scratch.ensure(meta.cwd, true)
    const log = await loadLog(sessionId)
    const settings = await readSessionFile(Path.settings(sessionId), { reasoning: 'auto' }, 'settings.json')
    const savedRedo = await readSessionFile(Path.historyRedo(sessionId), null, 'history-redo.json')
    const history = {
        messages: log.records,
        redo: Array.isArray(log.redo) ? log.redo : (Array.isArray(savedRedo) ? savedRedo : []),
        persistedCount: log.records.length,
        offsets: log.offsets,
        fileSize: log.size,
        legacy: log.legacy === true,
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
        history: { messages: [], redo: [], persistedCount: 0, offsets: [], fileSize: 0, legacy: false, rewrite: false },
        settings,
    }
    store.sessions[id] = session
    await save(id)
    return session
}

// --- 把整份时间线写成 JSONL；只有首次迁移或回退/重建时才走这里 ---
const writeAll = async session => {
    const history = session.history
    const lines = []
    const offsets = []
    let size = 0
    for (const record of history.messages) {
        offsets.push(size)
        const line = `${JSON.stringify(record)}\n`
        lines.push(line)
        size += Buffer.byteLength(line)
    }
    await writeFile(Path.historyLog(session.id), lines.join(''))
    history.persistedCount = history.messages.length
    history.offsets = offsets
    history.fileSize = size
    history.legacy = false
    history.rewrite = false
    // 旧格式迁移完成后删掉这些文件；JSONL 是唯一历史来源。
    await rm(Path.history(session.id), { force: true })
    await rm(Path.historyArchives(session.id), { recursive: true, force: true })
    await rm(Path.historyIndex(session.id), { force: true })
}

// --- 正常对话只追加新行，不碰已经写好的历史 ---
const appendNew = async session => {
    const history = session.history
    const records = history.messages.slice(history.persistedCount)
    if (!records.length) return
    let size = history.fileSize || 0
    const offsets = history.offsets.slice(0, history.persistedCount)
    const lines = []
    for (const record of records) {
        offsets.push(size)
        const line = `${JSON.stringify(record)}\n`
        lines.push(line)
        size += Buffer.byteLength(line)
    }
    // 上次崩溃可能留下半行；从旧的有效结尾继续追加。
    const actual = await Bun.file(Path.historyLog(session.id)).size
    if (actual > history.fileSize) await truncate(Path.historyLog(session.id), history.fileSize)
    await appendFile(Path.historyLog(session.id), lines.join(''))
    history.persistedCount = history.messages.length
    history.offsets = offsets
    history.fileSize = size
}

// --- 保存一条会话：历史追加，元数据和设置分开写 ---
const save = async sessionId => {
    const session = store.sessions[sessionId]
    if (!session) throw new Error(`Session not loaded: ${sessionId}`)
    await mkdir(Path.session(sessionId), { recursive: true })

    const history = session.history
    if (history.legacy || history.rewrite || !Number.isInteger(history.persistedCount) || history.persistedCount > history.messages.length) {
        await writeAll(session)
    } else if (history.messages.length > history.persistedCount) {
        await appendNew(session)
    }

    await writeFile(Path.meta(sessionId), JSON.stringify(metaOf(session), null, 2))
    await writeFile(Path.settings(sessionId), JSON.stringify(session.settings, null, 2))
    await writeFile(Path.historyRedo(sessionId), JSON.stringify(session.history.redo, null, 2))

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
    session.history.rewrite = true
    session.updatedAt = Date.now()
}

// --- 撤销最近一次回退 ---
const redo = async ({ sessionId }) => {
    const session = store.sessions[sessionId]
    const records = session.history.redo.pop()
    if (records) session.history.messages.push(...records)
    session.history.rewrite = true
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

// --- 直接流式扫描 JSONL 取一页，不把整份历史读进内存 ---
const pageByOffset = async ({ sessionId, beforeOffset, limit = 200 }) => {
    const size = Math.min(500, Math.max(1, Math.floor(Number(limit) || 200)))
    if (!await Bun.file(Path.historyLog(sessionId)).exists()) {
        // 旧会话还没迁到 JSONL：先按旧格式读，下一次保存会迁移。
        const session = await load(sessionId)
        const messages = get({ sessionId })
        const end = Number.isInteger(beforeOffset) ? Math.max(0, beforeOffset) : messages.length
        return {
            messages: messages.slice(Math.max(0, end - size), end).map(({ messageId, ...message }) => ({ messageId, ...message })),
            startOffset: 0,
            endOffset: 0,
            total: messages.length,
            hasMore: end > size,
        }
    }
    const end = Number.isInteger(beforeOffset) ? Math.max(0, beforeOffset) : Infinity
    const ring = []
    const offsets = []
    let offset = 0
    let total = 0
    let buffer = Buffer.alloc(0)
    const stream = createReadStream(Path.historyLog(sessionId))
    try {
        for await (const chunk of stream) {
            buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk
            let lineEnd = buffer.indexOf(10)
            while (lineEnd >= 0) {
                const line = buffer.subarray(0, lineEnd)
                buffer = buffer.subarray(lineEnd + 1)
                if (line.length && offset < end) {
                    const record = JSON.parse(line.toString('utf8'))
                    ring.push(record)
                    offsets.push(offset)
                    if (ring.length > size) { ring.shift(); offsets.shift() }
                    total += 1
                }
                offset += lineEnd + 1
                lineEnd = buffer.indexOf(10)
            }
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error
    }
    return {
        messages: ring.map(record => ({ messageId: record.messageId, ...(record.message || record) })),
        startOffset: offsets[0] ?? 0,
        endOffset: Number.isFinite(end) ? Math.min(end, offset) : offset,
        total,
        hasMore: (offsets[0] ?? 0) > 0,
    }
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

const rawText = message => {
    const parts = Array.isArray(message?.content) ? message.content : []
    const text = parts.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('')
    return String(text || (typeof message?.content === 'string' ? message.content : ''))
}

const outputText = output => {
    if (typeof output === 'string') return output
    if (typeof output?.value === 'string') return output.value
    if (typeof output?.value?.text === 'string') return output.value.text
    if (typeof output?.text === 'string') return output.text
    return ''
}

// 和右侧定位条的回答预览保持一致：取结束工具的最终输出原文。
const answerText = messages => {
    let answer = ''
    for (const message of messages) {
        const parts = Array.isArray(message?.content) ? message.content : []
        for (const part of parts) {
            if (part?.type !== 'tool-result') continue
            if (!['attempt_completion', 'ask_followup_question'].includes(part.toolName)) continue
            const text = outputText(part.output)
            if (text) answer = String(text)
        }
    }
    return answer
}

const userText = message => {
    const raw = rawText(message)
    const cut = raw.indexOf('\n\n附件 "')
    return (cut >= 0 ? raw.slice(0, cut) : raw).trimEnd()
}

// --- 整个会话的轮次大纲：只带预览，长度用未截断原文 ---
const outline = async sessionId => {
    await load(sessionId)
    const records = store.sessions[sessionId].history.messages
    const turns = []
    let current = null

    const finish = () => {
        if (!current) return
        const response = answerText(current.messages)
        if (current.role === 'assistant' && !response) {
            current = null
            return
        }
        const prompt = current.prompt
        turns.push({
            id: current.id,
            index: current.index,
            role: current.role,
            prompt: prompt.replace(/\s+/g, ' ').trim().slice(0, 120),
            response: response.replace(/\s+/g, ' ').trim().slice(0, 240),
            length: prompt.length + response.length,
        })
        current = null
    }

    for (const [index, record] of records.entries()) {
        const message = record.message
        if (!message) continue
        if (message.compact) {
            finish()
            continue
        }
        if (message.role === 'user') {
            finish()
            current = {
                id: record.messageId,
                index,
                role: 'user',
                prompt: userText(message),
                messages: [],
            }
            continue
        }
        if (message.role === 'assistant') {
            if (!current) {
                current = {
                    id: record.messageId,
                    index,
                    role: 'assistant',
                    prompt: '',
                    messages: [],
                }
            }
            current.messages.push(message)
            continue
        }
        if (message.role === 'tool' && current) current.messages.push(message)
    }
    finish()

    return { turns, totalMessages: records.length }
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
    add, rollback, redo, redoCount, idsBefore, get, page, pageByOffset, outline,
    count, remove, clear, destroy, prepare, setRunning, saveMeta, runningOnDisk,
}
