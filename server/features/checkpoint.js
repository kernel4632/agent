/* 文件写入前留下快照；rollback 截断历史，undo 恢复 rollback 前现场。 */
import { chmod, mkdir, readFile, rm } from 'node:fs/promises'
import { writeFile } from 'atomically'
import Store from '../store.js'
import Path from '../utils/path.js'

let queue = Promise.resolve()

const save = (sessionID, position, path) => {
    queue = queue.catch(() => {}).then(async () => {
        const logPath = `${Path.undo(sessionID)}.jsonl`
        const text = await readFile(logPath, 'utf8')
            .catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))
        const items = text.split('\n').filter(Boolean).map(JSON.parse)
        const sequence = crypto.randomUUID()
        await mkdir(Path.undo(sessionID), { recursive: true, mode: 0o700 })

        const existed = await Bun.file(path).exists()
        if (existed) {
            const snapshot = `${Path.undo(sessionID)}/${sequence}`
            await Bun.write(snapshot, Bun.file(path))
            await chmod(snapshot, 0o600)
        }

        items.push({ type: 'write', sequence, ...position, path, existed })
        const lines = items.map(JSON.stringify).join('\n')
        await writeFile(logPath, `${lines}\n`, { mode: 0o600 })
    })
    return queue
}

const rollback = (sessionID, position) => {
    queue = queue.catch(() => {}).then(async () => {
        const session = Store.sessions[sessionID]
        if (Store.runtimes[sessionID].status !== 'idle') throw new Error('Session must be idle')

        const target = session.messages.findIndex(message => message.id === position.messageID)
        if (!session.messages[target]?.parts[position.partIndex]) throw new Error('Message part not found')

        const logPath = `${Path.undo(sessionID)}.jsonl`
        const text = await readFile(logPath, 'utf8')
            .catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))
        const items = text.split('\n').filter(Boolean).map(JSON.parse)
        const writes = items.filter(item => {
            if (item.type !== 'write') return false
            const index = session.messages.findIndex(message => message.id === item.messageID)
            return index > target || index === target && item.partIndex >= position.partIndex
        })

        const files = []
        const sequence = crypto.randomUUID()
        await mkdir(Path.undo(sessionID), { recursive: true, mode: 0o700 })
        for (const path of [...new Set(writes.map(item => item.path))]) {
            const existed = await Bun.file(path).exists()
            const snapshot = `${Path.undo(sessionID)}/${sequence}-${files.length}`
            if (existed) {
                await Bun.write(snapshot, Bun.file(path))
                await chmod(snapshot, 0o600)
            }
            files.push({ path, existed, snapshot })
        }

        const record = {
            type: 'rollback',
            messages: structuredClone(session.messages),
            files,
            removed: writes,
        }
        const history = [...items.filter(item => !writes.includes(item)), record]
        const lines = history.map(JSON.stringify).join('\n')
        await writeFile(logPath, `${lines}\n`, { mode: 0o600 })

        for (const item of writes.toReversed()) {
            if (item.existed) await Bun.write(item.path, Bun.file(`${Path.undo(sessionID)}/${item.sequence}`))
            else await rm(item.path, { force: true })
        }
        session.messages = session.messages.slice(0, target + 1)
        session.messages[target].parts = session.messages[target].parts.slice(0, position.partIndex)
        if (!session.messages[target].parts.length) session.messages.pop()
        await Store.save(sessionID)
        return session
    })
    return queue
}

const undo = sessionID => {
    queue = queue.catch(() => {}).then(async () => {
        const logPath = `${Path.undo(sessionID)}.jsonl`
        const text = await readFile(logPath, 'utf8')
            .catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))
        const items = text.split('\n').filter(Boolean).map(JSON.parse)
        const index = items.findLastIndex(item => item.type === 'rollback')
        if (index < 0) return null

        const record = items[index]
        for (const item of items.slice(index + 1).filter(item => item.type === 'write').toReversed()) {
            if (item.existed) await Bun.write(item.path, Bun.file(`${Path.undo(sessionID)}/${item.sequence}`))
            else await rm(item.path, { force: true })
        }
        for (const file of record.files) {
            if (file.existed) await Bun.write(file.path, Bun.file(file.snapshot))
            else await rm(file.path, { force: true })
        }

        Store.sessions[sessionID].messages = structuredClone(record.messages)
        await Store.save(sessionID)
        const history = [...items.slice(0, index), ...record.removed]
        const lines = history.map(JSON.stringify).join('\n')
        await writeFile(logPath, lines ? `${lines}\n` : '', { mode: 0o600 })
        return Store.sessions[sessionID]
    })
    return queue
}

export default { save, rollback, undo }
