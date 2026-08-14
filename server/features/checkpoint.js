/* 每次写文件先留快照；rollback 本身也留快照，所以可以精确 undo。 */
import { chmod, mkdir, readFile, rm, unlink } from 'node:fs/promises'
import { writeFile } from 'atomically'
import Store from '../store.js'
import Path from '../utils/path.js'
const entries = async id => (await readFile(Path.undoLog(id), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(JSON.parse)
const locks = new Map()
const serial = (id, action) => {
    const previous = locks.get(id) || Promise.resolve()
    const current = previous.catch(() => {}).then(action)
    const cleanup = current.finally(() => { if (locks.get(id) === cleanup) locks.delete(id); if (Store.runtimes[id]?.checkpointTask === cleanup) delete Store.runtimes[id].checkpointTask })
    cleanup.catch(() => {}); locks.set(id, cleanup); if (Store.runtimes[id]) Store.runtimes[id].checkpointTask = cleanup
    return current
}
const writeEntries = async (id, items) => {
    await writeFile(Path.undoLog(id), items.map(JSON.stringify).join('\n') + (items.length ? '\n' : ''), { mode: 0o600 }); return chmod(Path.undoLog(id), 0o600)
}
const restore = (file, snapshot) => file.existed ? Bun.write(file.path, Bun.file(snapshot)) : rm(file.path, { force: true })
const truncate = (session, position) => {
    const index = session.messages.findIndex(message => message.id === position.messageID)
    if (index < 0 || position.partIndex < 0 || position.partIndex >= session.messages[index].parts.length) throw new Error('Message part not found')
    session.messages = session.messages.slice(0, index + 1)
    session.messages[index].parts = session.messages[index].parts.slice(0, position.partIndex)
    if (!session.messages[index].parts.length) session.messages.pop()
}
const save = (sessionID, position, path) => serial(sessionID, async () => {
    if (!Store.sessions[sessionID] || Store.runtimes[sessionID].removing) throw new Error('Session not found'); const items = await entries(sessionID)
    const sequence = crypto.randomUUID()
    await mkdir(Path.undo(sessionID), { recursive: true, mode: 0o700 }); await chmod(Path.undo(sessionID), 0o700)
    const existed = await Bun.file(path).exists()
    if (existed) { await Bun.write(`${Path.undo(sessionID)}/${sequence}`, Bun.file(path)); await chmod(`${Path.undo(sessionID)}/${sequence}`, 0o600) }
    await writeEntries(sessionID, [...items, { type: 'write', sequence, ...position, path, existed }])
})
const rollback = (sessionID, position) => serial(sessionID, async () => {
    const session = Store.sessions[sessionID]
    if (!session || Store.runtimes[sessionID].removing || Store.runtimes[sessionID].status !== 'idle') throw new Error('Session must be idle')
    const target = session.messages.findIndex(message => message.id === position.messageID)
    if (target < 0) throw new Error('Message not found')
    if (position.partIndex < 0 || position.partIndex >= session.messages[target].parts.length) throw new Error('Message part not found')
    const items = await entries(sessionID)
    const writes = items.filter(item => item.type === 'write' && (() => {
        const index = session.messages.findIndex(message => message.id === item.messageID)
        return index > target || index === target && item.partIndex >= position.partIndex
    })())
    const sequence = crypto.randomUUID()
    const files = []
    await mkdir(Path.undo(sessionID), { recursive: true, mode: 0o700 })
    for (const [index, path] of [...new Set(writes.map(item => item.path))].entries()) {
        const existed = await Bun.file(path).exists()
        const snapshot = `${Path.undo(sessionID)}/${sequence}-${index}`
        if (existed) { await Bun.write(snapshot, Bun.file(path)); await chmod(snapshot, 0o600) }
        files.push({ path, existed, snapshot })
    }
    const rollback = { type: 'rollback', state: 'prepared', sequence, position, messages: structuredClone(session.messages), files, removed: writes }
    const history = [...items.filter(item => !writes.includes(item)), rollback]
    /* 先落盘 prepared，任何中途崩溃都能按当前文件快照恢复。 */
    await writeEntries(sessionID, history)
    for (const item of writes.toReversed()) item.existed ? await Bun.write(item.path, Bun.file(`${Path.undo(sessionID)}/${item.sequence}`)) : await unlink(item.path).catch(() => {})
    truncate(session, position)
    await Store.save(sessionID)
    rollback.state = 'committed'; await writeEntries(sessionID, history)
    return session
})
const finishUndo = async (sessionID, items, index) => {
    const rollback = items[index]
    for (const item of items.slice(index + 1).filter(item => item.type === 'write').toReversed()) await restore(item, `${Path.undo(sessionID)}/${item.sequence}`)
    for (const file of rollback.files) await restore(file, file.snapshot)
    Store.sessions[sessionID].messages = structuredClone(rollback.messages)
    await Store.save(sessionID)
    await writeEntries(sessionID, [...items.slice(0, index), ...rollback.removed])
    return Store.sessions[sessionID]
}
const undo = sessionID => serial(sessionID, async () => {
    const items = await entries(sessionID)
    const index = items.findLastIndex(item => item.type === 'rollback' && item.state !== 'prepared')
    if (index < 0) return null
    if (Store.runtimes[sessionID].removing || Store.runtimes[sessionID].status !== 'idle') throw new Error('Session must be idle')
    await writeEntries(sessionID, [...items, { type: 'undo', state: 'prepared', rollback: items[index].sequence }])
    return finishUndo(sessionID, items, index)
})
const recover = async sessionID => {
    const items = await entries(sessionID)
    const pendingUndo = items.findLast(item => item.type === 'undo' && item.state === 'prepared')
    if (pendingUndo) {
        const original = items.filter(item => item !== pendingUndo)
        const index = original.findIndex(item => item.type === 'rollback' && item.sequence === pendingUndo.rollback)
        if (index >= 0) { await finishUndo(sessionID, original, index); return true }
    }
    const rollback = items.findLast(item => item.type === 'rollback' && item.state === 'prepared')
    if (!rollback) return false
    const session = Store.sessions[sessionID]
    if (!session) return false
    for (const item of rollback.removed.toReversed()) await restore(item, `${Path.undo(sessionID)}/${item.sequence}`)
    session.messages = structuredClone(rollback.messages); truncate(session, rollback.position)
    rollback.state = 'committed'
    await Store.save(sessionID)
    await writeEntries(sessionID, items)
    return true
}
export { recover }; export default { save, rollback, undo }
