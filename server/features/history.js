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
import { createInterface } from 'node:readline'
import { writeFile } from 'atomically'
import { nanoid } from 'nanoid'
import store from '../store.js'
import Path from '../utils/path.js'
import TempWorkspace from '../utils/temp-workspace.js'
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

// --- 读取一个 JSONL 分块；分块和旧单体日志用同一种记录格式 ---
const readRecords = async (file, label, required = true) => {
    const records = []
    if (!await Bun.file(file).exists()) {
        if (required) throw fail(500, `会话历史分块丢失：${label}`)
        return records
    }
    const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
    for await (const line of lines) {
        if (!line.trim()) continue
        try {
            records.push(JSON.parse(line))
        } catch {
            // 崩溃留下的最后半行不参与读取。
            break
        }
    }
    return records
}

// --- 读取按 compact 边界拆开的存段 ---
// manifest 里的 segment.compact 是压缩消息本身；分块文件里只放它之前的原始消息。
const readSegmented = async sessionId => {
    const manifest = await readSessionFile(Path.historyIndex(sessionId), null, 'history-index.json')
    if (!manifest || manifest.format !== 2 || !Array.isArray(manifest.segments)) {
        throw fail(500, '会话历史索引损坏')
    }
    const records = []
    for (const segment of manifest.segments) {
        const file = join(Path.historyArchives(sessionId), segment.file)
        records.push(...await readRecords(file, segment.file))
        if (segment.compact) records.push(segment.compact)
    }
    const current = await readRecords(join(Path.historyArchives(sessionId), manifest.current?.file || 'current.jsonl'), 'current.jsonl', false)
    records.push(...current)
    return {
        records,
        offsets: [],
        size: Number(manifest.bytes) || 0,
        legacy: false,
        segmented: true,
        manifest,
        current,
    }
}

const readLog = async (sessionId, onProgress) => {
    const records = []
    const offsets = []
    let offset = 0
    let buffer = Buffer.alloc(0)
    const totalBytes = await Bun.file(Path.historyLog(sessionId)).size
    let lastReport = 0
    const report = (done = false) => {
        if (!onProgress) return
        const now = Date.now()
        if (!done && now - lastReport < 50) return
        lastReport = now
        onProgress({ bytes: offset, totalBytes, done })
    }
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
                        report(true)
                        return { records, offsets, size: offset }
                    }
                }
                offset += lineEnd + 1
                lineEnd = buffer.indexOf(10)
            }
            report()
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        report(true)
        return { records: [], offsets: [], size: 0, missing: true }
    }
    report(true)
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

const loadLog = async (sessionId, onProgress) => {
    const index = await readSessionFile(Path.historyIndex(sessionId), null, 'history-index.json')
    if (index?.format === 2) return readSegmented(sessionId)
    if (await Bun.file(Path.historyLog(sessionId)).exists()) return readLog(sessionId, onProgress)
    if (await Bun.file(Path.history(sessionId)).exists()) return readLegacy(sessionId)
    onProgress?.({ bytes: 0, totalBytes: 0, done: true })
    return { records: [], offsets: [], size: 0, legacy: false, redo: [] }
}

const needsSegmentation = log => log.records.some(record => record?.message?.compact)

const load = async (sessionId, { onProgress } = {}) => {
    if (store.sessions[sessionId]) {
        onProgress?.({ bytes: 1, totalBytes: 1, done: true })
        return store.sessions[sessionId]
    }

    const metaFile = Bun.file(Path.meta(sessionId))
    if (!await metaFile.exists()) throw fail(404, `Session not found: ${sessionId}`)
    const meta = await metaFile.json()                                // 当前形状的会话资料
    const temporary = meta.temporary === true
    if (temporary) await TempWorkspace.ensure(meta.cwd, true)
    const log = await loadLog(sessionId, onProgress)
    const settings = await readSessionFile(Path.settings(sessionId), { reasoning: 'auto' }, 'settings.json')
    const savedRedo = await readSessionFile(Path.historyRedo(sessionId), null, 'history-redo.json')
    const history = {
        messages: log.records,
        redo: Array.isArray(log.redo) ? log.redo : (Array.isArray(savedRedo) ? savedRedo : []),
        persistedCount: log.records.length,
        offsets: log.offsets,
        fileSize: log.size,
        legacy: log.legacy === true,
        segmented: log.segmented === true,
        manifest: log.manifest || null,
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
    // 老会话第一次打开时按 compact 边界拆一次；拆分失败不能影响读取，
    // 下次保存还会再试，旧 JSONL 仍然完整。
    // 迁移必须留在 load 里，不能推迟到 save：manifestFor() 只认 history.segmented，
    // 不在这里拆的话，老会话第一次打开拿不到 manifest，read 会把全部历史发给前端。
    if (!history.segmented && needsSegmentation(log)) {
        try {
            await writeAllSegmented(session)
        } catch (error) {
            console.warn(`[session] 历史分块迁移失败，继续使用 JSONL：${error.message}`)
        }
    }
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
        history: { messages: [], redo: [], persistedCount: 0, offsets: [], fileSize: 0, legacy: false, rewrite: false, rewriteFrom: null },
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
    history.rewriteFrom = null
    history.segmented = false
    history.manifest = null
    // 旧格式迁移完成后删掉这些文件；JSONL 是唯一历史来源。
    await rm(Path.history(session.id), { force: true })
    await rm(Path.historyArchives(session.id), { recursive: true, force: true })
    await rm(Path.historyIndex(session.id), { force: true })
}

// --- 按 compact 边界把完整历史拆成“封存段 + 当前段” ---
// 每段文件只放 compact 之前的原始消息；compact 本身存在 manifest 里，
// 前端不打开段也能显示压缩摘要。
const segmentFileName = index => `segment-${String(index + 1).padStart(4, '0')}.jsonl`
const jsonlText = records => records.map(record => `${JSON.stringify(record)}\n`).join('')

const writeAllSegmented = async session => {
    const history = session.history
    const directory = Path.historyArchives(session.id)
    await rm(directory, { recursive: true, force: true })
    await mkdir(directory, { recursive: true })
    const segments = []
    const messages = history.messages
    let start = 0
    let bytes = 0
    for (let index = 0; index < messages.length; index += 1) {
        const record = messages[index]
        if (!record?.message?.compact) continue
        const raw = messages.slice(start, index)
        const id = `segment-${String(segments.length + 1).padStart(4, '0')}`
        const file = segmentFileName(segments.length)
        const text = jsonlText(raw)
        await writeFile(join(directory, file), text)
        bytes += Buffer.byteLength(text)
        segments.push({
            id,
            file,
            count: raw.length,
            startIndex: start,
            endIndex: index - 1,
            compactIndex: index,
            messageIds: raw.map(record => record.messageId),
            compact: record,
        })
        start = index + 1
    }
    const current = messages.slice(start)
    const currentFile = 'current.jsonl'
    const currentText = jsonlText(current)
    await writeFile(join(directory, currentFile), currentText)
    bytes += Buffer.byteLength(currentText)
    const manifest = {
        format: 2,
        segments,
        current: { file: currentFile, count: current.length, startIndex: start },
        bytes,
        updatedAt: Date.now(),
    }
    await writeFile(Path.historyIndex(session.id), JSON.stringify(manifest))
    history.segmented = true
    history.manifest = manifest
    history.persistedCount = messages.length
    history.offsets = []
    history.fileSize = bytes
    history.legacy = false
    history.rewrite = false
    history.rewriteFrom = null
    // 分块是唯一历史来源后，删掉旧单体日志，避免下次误读旧内容。
    await rm(Path.historyLog(session.id), { force: true })
    await rm(Path.history(session.id), { force: true })
}

// --- 只重写当前段：回退/撤销通常落在最新段，前面的封存段不用动 ---
const writeCurrentSegmented = async session => {
    const history = session.history
    const current = history.manifest?.current
    if (!current) return writeAllSegmented(session)
    const records = history.messages.slice(current.startIndex)
    const file = join(Path.historyArchives(session.id), current.file)
    const oldSize = await Bun.file(file).size
    const text = jsonlText(records)
    const newSize = Buffer.byteLength(text)
    await writeFile(file, text)
    current.count = records.length
    history.manifest.bytes = (Number(history.manifest.bytes) || 0) + newSize - oldSize
    history.manifest.updatedAt = Date.now()
    await writeFile(Path.historyIndex(session.id), JSON.stringify(history.manifest))
    history.persistedCount = history.messages.length
    history.fileSize = (Number(history.fileSize) || 0) + newSize - oldSize
    history.rewrite = false
    history.rewriteFrom = null
}

// --- 只追加当前段；出现新 compact 才整份重新分段 ---
const appendSegmented = async session => {
    const history = session.history
    const messages = history.messages
    if (!history.manifest?.current) return writeAllSegmented(session)
    if (history.persistedCount > messages.length) return writeAllSegmented(session)
    const records = messages.slice(history.persistedCount)
    if (!records.length) return
    if (records.some(record => record?.message?.compact)) return writeAllSegmented(session)
    const file = join(Path.historyArchives(session.id), history.manifest.current.file)
    const text = jsonlText(records)
    await appendFile(file, text)
    history.manifest.current.count += records.length
    history.manifest.updatedAt = Date.now()
    history.manifest.bytes = (Number(history.manifest.bytes) || 0) + Buffer.byteLength(text)
    await writeFile(Path.historyIndex(session.id), JSON.stringify(history.manifest))
    history.persistedCount = messages.length
    history.fileSize = (history.fileSize || 0) + Buffer.byteLength(text)
}

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
    const hasCompact = history.messages.some(record => record?.message?.compact)
    if (hasCompact) {
        if (!history.segmented || history.rewrite || !Number.isInteger(history.persistedCount) || history.persistedCount > history.messages.length) {
            const canRewriteCurrent = Number.isInteger(history.rewriteFrom)
                && history.manifest?.current
                && history.rewriteFrom >= history.manifest.current.startIndex
            if (canRewriteCurrent) await writeCurrentSegmented(session)
            else await writeAllSegmented(session)
        } else if (history.messages.length > history.persistedCount) {
            await appendSegmented(session)
        }
    } else if (history.legacy || history.rewrite || history.segmented || !Number.isInteger(history.persistedCount) || history.persistedCount > history.messages.length) {
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
const settings = async ({ sessionId, settings }) => {
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

// --- 读取原始记录：精确回退要在不丢 messageId 的前提下重写一条消息 ---
const records = ({ sessionId }) => {
    const session = store.sessions[sessionId]
    if (!session) throw new Error(`History not loaded: ${sessionId}`)
    return session.history.messages.map(record => ({ messageId: record.messageId, message: record.message }))
}

// --- 从某条消息开始替换尾部：正文块回退会保留同一条消息的前半段 ---
const replace = ({ sessionId, messageId, next }) => {
    const session = store.sessions[sessionId]
    const index = session.history.messages.findIndex(record => record.messageId === messageId)
    if (index < 0) throw fail(404, `Message not found: ${messageId}`)

    const removed = session.history.messages.slice(index)
    session.history.messages.splice(index, session.history.messages.length - index, ...next)
    // redo 对象记住原始尾部；撤销时整段换回去，不会和截断后的同一条消息重复。
    session.history.redo.push({ replaceFrom: index, records: removed })
    session.history.rewrite = true
    session.history.rewriteFrom = index
    session.updatedAt = Date.now()
    return session
}

// --- 回退到这条消息之前；不管退哪条消息，它和它之后的全部都会消失 ---
const rollback = async ({ sessionId, messageId }) => {
    const session = store.sessions[sessionId]
    const index = session.history.messages.findIndex(record => record.messageId === messageId)
    if (index < 0) throw fail(404, `Message not found: ${messageId}`)

    session.history.redo.push({ replaceFrom: index, records: session.history.messages.slice(index) })
    session.history.messages.splice(index)
    session.history.rewrite = true
    session.history.rewriteFrom = index
    session.updatedAt = Date.now()
}

// --- 撤销最近一次回退 ---
const redo = async ({ sessionId }) => {
    const session = store.sessions[sessionId]
    const last = session.history.redo.pop()
    if (last?.replaceFrom != null) {
        session.history.messages.splice(last.replaceFrom, session.history.messages.length - last.replaceFrom, ...last.records)
        session.history.rewriteFrom = last.replaceFrom
    } else if (Array.isArray(last)) {
        session.history.messages.push(...last)
        session.history.rewriteFrom = null
    }
    session.history.rewrite = true
    session.updatedAt = Date.now()
}

// --- 任务开跑 / 结束时更新运行标记 ---
// 这个入口故意只改内存：开跑时落盘由 startRun 的 mark 负责，收尾时的落盘也
// 用 mark 补一笔（syncHistory 发生在 finishRun 之前，会把 true 一起写下去）。
// 崩溃时最多留下一个“其实已结束”的脏标记，恢复时能识别。
const running = (sessionId, running) => {
    const session = store.sessions[sessionId]
    if (!session) return
    session.running = Boolean(running)
    if (running) session.updatedAt = Date.now()
}

// --- 只把 meta 写回磁盘：运行标记的变化用，不动历史也不清 SSE 缓存 ---
const mark = async sessionId => {
    const session = store.sessions[sessionId]
    if (!session) return
    await mkdir(Path.session(sessionId), { recursive: true })
    await writeFile(Path.meta(sessionId), JSON.stringify(metaOf(session), null, 2))
}

// --- 还有几次回退可以撤销 ---
const redos = ({ sessionId }) => store.sessions[sessionId]?.history.redo.length || 0

// --- 读取当前历史：把 messageId 摊回消息对象上 ---
const get = ({ sessionId }) => {
    const session = store.sessions[sessionId]
    if (!session) throw new Error(`History not loaded: ${sessionId}`)
    return session.history.messages.map(({ messageId, message }) => ({ messageId, ...message }))
}

// --- 给前端的 manifest：不暴露磁盘路径，只给段 id、计数和压缩消息 ---
const publicRecord = record => ({ messageId: record.messageId, ...record.message })

const manifestFor = session => {
    const history = session?.history
    if (!history?.segmented || !history.manifest) return null
    return {
        format: 2,
        total: history.messages.length,
        currentStart: history.manifest.current?.startIndex ?? 0,
        segments: history.manifest.segments.map(segment => ({
            id: segment.id,
            count: segment.count,
            startIndex: segment.startIndex,
            endIndex: segment.endIndex,
            compactIndex: segment.compactIndex,
            messageIds: segment.messageIds || [],
            compact: publicRecord(segment.compact),
        })),
    }
}

// --- 前端初次只拿 manifest + 当前段；历史段展开时再按 id 读 ---
const page = ({ sessionId, history }) => {
    const session = store.sessions[sessionId]
    if (!session) throw new Error(`History not loaded: ${sessionId}`)
    const records = Array.isArray(history) ? history : get({ sessionId })
    let currentStart = 0
    for (let index = records.length - 1; index >= 0; index -= 1) {
        if (records[index]?.compact) { currentStart = index + 1; break }
    }
    return {
        manifest: manifestFor(session),
        current: records.slice(currentStart),
        currentStart,
    }
}

const segment = async ({ sessionId, segmentId }) => {
    await load(sessionId)
    const history = store.sessions[sessionId].history
    const found = history.manifest?.segments?.find(item => item.id === segmentId)
    if (!found) throw fail(404, `History segment not found: ${segmentId}`)
    const file = join(Path.historyArchives(sessionId), found.file)
    const records = await readRecords(file, found.file)
    return { id: found.id, messages: records.filter(record => !record.message?.internal).map(publicRecord) }
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
    const records = store.sessions[sessionId].history.messages.filter(record => !record.message?.internal)
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

// --- 全量历史搜索：先在内存里拼回完整历史，跨所有封存段和当前段 ---
const readableSearchText = value => String(value ?? '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const searchableText = message => {
    if (!message || message.compact) return ''
    const content = message.content
    const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
            ? content.filter(part => part?.type === 'text').map(part => part.text || '').join(' ')
            : ''
    return readableSearchText(text)
}

const search = async ({ sessionId, query, limit = 50 }) => {
    const needle = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 100)
    if (!needle) return { results: [] }
    const lower = needle.toLocaleLowerCase()
    const max = Math.min(50, Math.max(1, Math.floor(Number(limit) || 50)))
    const results = []
    await load(sessionId)
    let index = -1
    for (const record of store.sessions[sessionId].history.messages) {
        if (results.length >= max) break
        const message = record?.message
        if (!message || message.internal || message.compact) continue
        index += 1
        const text = searchableText(message)
        if (!text) continue
        const at = text.toLocaleLowerCase().indexOf(lower)
        if (at < 0) continue
        const start = Math.max(0, at - 36)
        const end = Math.min(text.length, at + needle.length + 90)
        results.push({
            id: record.messageId,
            index,
            role: message.role,
            before: `${start ? '…' : ''}${text.slice(start, at)}`,
            match: text.slice(at, at + needle.length),
            after: `${text.slice(at + needle.length, end)}${end < text.length ? '…' : ''}`,
        })
    }
    return { results }
}
// --- 内存里加载了多少条会话；健康检查用 ---
const count = () => Object.keys(store.sessions).length

// --- 磁盘上还带着运行标记的会话：重启后从这里挑出要自动续跑的 ---
const stale = async () => {
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
    load, create, save, settings, list,
    add, rollback, redo, redos, get, records, replace, outline, search, page, segment,
    count, remove, clear, destroy, prepare, running, mark, stale,
}
