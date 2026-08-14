/* 每次写文件先留快照；rollback 本身也留快照，所以可以精确 undo。 */
import { chmod, mkdir, readFile, rm, unlink } from 'node:fs/promises'
import { writeFile } from 'atomically'
import Store from '../store.js'
import Session from '../commands/session.js'
import Path from '../utils/path.js'

const entries = async id => (await readFile(Path.undoLog(id), 'utf8').catch(() => ''))
    .split('\n').filter(Boolean).map(JSON.parse)
const locks = new Map()
const serial = (id, action) => {
    const previous = locks.get(id) || Promise.resolve()
    const current = previous.catch(() => {}).then(action)
    const cleanup = current.finally(() => { if (locks.get(id) === cleanup) locks.delete(id) })
    cleanup.catch(() => {})
    locks.set(id, cleanup)
    return current
}
const writeEntries = async (id, items) => {
    await writeFile(Path.undoLog(id), items.map(JSON.stringify).join('\n') + (items.length ? '\n' : ''), { mode: 0o600 })
    await chmod(Path.undoLog(id), 0o600)
}
const truncate = (session, position) => {
    const index = session.messages.findIndex(message => message.id === position.messageID)
    if (index < 0 || position.partIndex < 0 || position.partIndex >= session.messages[index].parts.length) throw new Error('Message part not found')
    session.messages = session.messages.slice(0, index + 1)
    session.messages[index].parts = session.messages[index].parts.slice(0, position.partIndex)
    if (!session.messages[index].parts.length) session.messages.pop()
}
const saveNow = async (sessionID, position, path) => {
    const items = await entries(sessionID)
    const sequence = crypto.randomUUID()
    await mkdir(Path.undo(sessionID), { recursive: true, mode: 0o700 })
    const existed = await Bun.file(path).exists()
    if (existed) { await Bun.write(`${Path.undo(sessionID)}/${sequence}`, Bun.file(path)); await chmod(`${Path.undo(sessionID)}/${sequence}`, 0o600) }
    await writeEntries(sessionID, [...items, { type: 'write', sequence, ...position, path, existed }])
}
const save = (sessionID, position, path) => serial(sessionID, () => saveNow(sessionID, position, path))
const rollbackNow = async (sessionID, position) => {
    const session = Store.sessions[sessionID]
    if (!session || Store.runtimes[sessionID].status !== 'idle') throw new Error('Session must be idle')
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
    for (const [index, path] of [...new Set(writes.map(item => item.path))].entries()) {
        const existed = await Bun.file(path).exists()
        const snapshot = `${Path.undo(sessionID)}/${sequence}-${index}`
        if (existed) { await Bun.write(snapshot, Bun.file(path)); await chmod(snapshot, 0o600) }
        files.push({ path, existed, snapshot })
    }
    for (const item of writes.toReversed()) item.existed ? await Bun.write(item.path, Bun.file(`${Path.undo(sessionID)}/${item.sequence}`)) : await unlink(item.path).catch(() => {})
    const rollback = { type: 'rollback', sequence, messages: structuredClone(session.messages), files, removed: writes }
    truncate(session, position)
    await Promise.all([Session.rewrite(sessionID), writeEntries(sessionID, [...items.filter(item => !writes.includes(item)), rollback])])
    return session
}
const rollback = (sessionID, position) => serial(sessionID, () => rollbackNow(sessionID, position))
const undo = sessionID => serial(sessionID, async () => {
    const items = await entries(sessionID)
    const index = items.findLastIndex(item => item.type === 'rollback')
    if (index < 0) return null
    if (Store.runtimes[sessionID].status !== 'idle') throw new Error('Session must be idle')
    const rollback = items[index]
    for (const item of items.slice(index + 1).filter(item => item.type === 'write').toReversed()) {
        item.existed ? await Bun.write(item.path, Bun.file(`${Path.undo(sessionID)}/${item.sequence}`)) : await rm(item.path, { force: true })
    }
    for (const file of rollback.files) file.existed ? await Bun.write(file.path, Bun.file(file.snapshot)) : await rm(file.path, { force: true })
    Store.sessions[sessionID].messages = rollback.messages
    await Promise.all([Session.rewrite(sessionID), writeEntries(sessionID, [...items.slice(0, index), ...rollback.removed])])
    return Store.sessions[sessionID]
})

export default { save, rollback, undo }
