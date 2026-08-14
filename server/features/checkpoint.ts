/*
文件检查点：写文件前保存原始字节，rollback 和 undo 按消息 part 恢复文件与会话。
调用示例：Checkpoint.save(sessionID, position, path)、Checkpoint.rollback(sessionID, position)。
*/
import { chmod, mkdir, readFile, rm, unlink } from 'node:fs/promises'
import { writeFile } from 'atomically'
import Session from '../commands/session.ts'
import Store from '../store.ts'
import type { CheckpointEntry, CheckpointPosition } from '../types.ts'
import Error from '../utils/error.ts'
import Path from '../utils/path.ts'

const list = async (sessionID: string) => {
    const text = await readFile(Path.checkpoints(sessionID), 'utf8').catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
        throw error
    })
    return text.split('\n').filter(Boolean).map((line, index) => {
        try {
            return JSON.parse(line) as CheckpointEntry
        } catch {
            throw new globalThis.Error(`Invalid JSONL at ${Path.checkpoints(sessionID)}:${index + 1}`)
        }
    })
}

const save = async (sessionID: string, position: CheckpointPosition, path: string) => {
    const entries = await list(sessionID)
    const sequence = (entries.at(-1)?.sequence ?? 0) + 1
    const file = Bun.file(path)
    const existed = await file.exists()
    const snapshot = existed ? `${Path.snapshots(sessionID)}/${sequence}` : undefined
    if (snapshot) {
        await mkdir(Path.snapshots(sessionID), { recursive: true, mode: 0o700 })
        await Bun.write(snapshot, file)
        await chmod(snapshot, 0o600)
    }
    const entry: CheckpointEntry = { ...position, sequence, path, existed, snapshot }
    await writeFile(Path.checkpoints(sessionID), `${[...entries, entry].map(item => JSON.stringify(item)).join('\n')}\n`, { mode: 0o600 })
    await chmod(Path.checkpoints(sessionID), 0o600)
    return entry
}

const rollback = async (sessionID: string, position: CheckpointPosition) => {
    const session = Store.sessions[sessionID]
    if (!session) throw Error.notFound('Session not found')
    if (Store.runtimes[sessionID]!.status === 'running') throw Error.conflict('Cannot rollback a running session')
    const targetMessage = session.messages.findIndex(message => message.id === position.messageID)
    if (targetMessage < 0) throw Error.notFound('Message not found')
    if (position.partIndex < 0 || position.partIndex >= session.messages[targetMessage]!.parts.length) throw Error.invalid('Part not found')

    const entries = await list(sessionID)
    const reverting = entries.filter(entry => {
        const entryMessage = session.messages.findIndex(message => message.id === entry.messageID)
        return entryMessage > targetMessage || entryMessage === targetMessage && entry.partIndex >= position.partIndex
    }).reverse()
    await writeFile(Path.rollback(sessionID), JSON.stringify({ position, reverting }), { mode: 0o600 })
    for (const entry of reverting) {
        if (entry.existed && entry.snapshot) await Bun.write(entry.path, Bun.file(entry.snapshot))
        if (!entry.existed && await Bun.file(entry.path).exists()) await unlink(entry.path)
    }
    Session.truncate(sessionID, position)
    const remaining = entries.filter(entry => !reverting.includes(entry))
    await Promise.all([
        Session.rewrite(sessionID),
        writeFile(Path.checkpoints(sessionID), remaining.length ? `${remaining.map(entry => JSON.stringify(entry)).join('\n')}\n` : '', { mode: 0o600 }),
    ])
    await rm(Path.rollback(sessionID), { force: true })
    await Promise.all(reverting.flatMap(entry => entry.snapshot ? [rm(entry.snapshot, { force: true })] : []))
    return session
}

const recover = async (sessionID: string) => {
    const text = await readFile(Path.rollback(sessionID), 'utf8').catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
        throw error
    })
    if (!text) return false
    const intent = JSON.parse(text) as { position: CheckpointPosition; reverting: CheckpointEntry[] }
    const session = Store.sessions[sessionID]
    if (!session) return false
    const entries = await list(sessionID)
    const sequences = new Set(entries.map(entry => entry.sequence))
    for (const entry of intent.reverting) {
        if (!sequences.has(entry.sequence)) continue
        if (entry.existed && entry.snapshot) await Bun.write(entry.path, Bun.file(entry.snapshot))
        if (!entry.existed && await Bun.file(entry.path).exists()) await unlink(entry.path)
    }
    const target = session.messages.find(message => message.id === intent.position.messageID)
    if (target && intent.position.partIndex <= target.parts.length) Session.truncate(sessionID, intent.position)
    const reverting = new Set(intent.reverting.map(entry => entry.sequence))
    const remaining = entries.filter(entry => !reverting.has(entry.sequence))
    await Promise.all([
        Session.rewrite(sessionID),
        writeFile(Path.checkpoints(sessionID), remaining.length ? `${remaining.map(entry => JSON.stringify(entry)).join('\n')}\n` : '', { mode: 0o600 }),
    ])
    await rm(Path.rollback(sessionID), { force: true })
    await Promise.all(intent.reverting.flatMap(entry => entry.snapshot ? [rm(entry.snapshot, { force: true })] : []))
    return true
}

const undo = async (sessionID: string) => {
    const entry = (await list(sessionID)).at(-1)
    if (!entry) return Store.sessions[sessionID] ?? null
    return rollback(sessionID, { messageID: entry.messageID, partIndex: entry.partIndex })
}

export default { list, save, rollback, recover, undo }
