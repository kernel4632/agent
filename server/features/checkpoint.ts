import { readFile, rm, unlink } from 'node:fs/promises'
import { writeFile } from 'atomically'
import Session from '../commands/session.ts'
import Store from '../store.ts'
import File from './checkpoint-file.ts'
import Error from '../utils/error.ts'
import Path from '../utils/path.ts'
import type { CheckpointPosition } from '../types.ts'

const rollbackNow = async (sessionID: string, position: CheckpointPosition) => {
    const session = Store.sessions[sessionID]
    if (!session) throw Error.notFound('Session not found')
    if (Store.runtimes[sessionID]!.status === 'running') throw Error.conflict('Cannot rollback a running session')
    const target = session.messages.findIndex(message => message.id === position.messageID)
    if (target < 0) throw Error.notFound('Message not found')
    if (position.partIndex < 0 || position.partIndex >= session.messages[target]!.parts.length) throw Error.invalid('Part not found')
    const entries = await File.list(sessionID)
    const reverting = entries.filter(entry => {
        const index = session.messages.findIndex(message => message.id === entry.messageID)
        return index > target || index === target && entry.partIndex >= position.partIndex
    }).reverse()
    await writeFile(Path.rollback(sessionID), JSON.stringify({ position, reverting }), { mode: 0o600 })
    for (const entry of reverting) {
        if (entry.existed && entry.snapshot) await Bun.write(entry.path, Bun.file(entry.snapshot))
        if (!entry.existed && await Bun.file(entry.path).exists()) await unlink(entry.path)
    }
    Session.truncate(sessionID, position)
    const remaining = entries.filter(entry => !reverting.includes(entry))
    await Promise.all([Session.rewrite(sessionID), writeFile(Path.checkpoints(sessionID), remaining.length ? `${remaining.map(entry => JSON.stringify(entry)).join('\n')}\n` : '', { mode: 0o600 })])
    await rm(Path.rollback(sessionID), { force: true })
    await Promise.all(reverting.flatMap(entry => entry.snapshot ? [rm(entry.snapshot, { force: true })] : []))
    return session
}

const rollback = async (sessionID: string, position: CheckpointPosition) => {
    const runtime = Store.runtimes[sessionID]
    if (!runtime) throw Error.notFound('Session not found')
    return runtime.sends.add(() => rollbackNow(sessionID, position))
}

const recover = async (sessionID: string) => {
    const text = await readFile(Path.rollback(sessionID), 'utf8').catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? '' : Promise.reject(error))
    if (!text) return false
    const intent = JSON.parse(text) as { position: CheckpointPosition; reverting: Awaited<ReturnType<typeof File.list>> }
    const session = Store.sessions[sessionID]
    if (!session) return false
    const entries = await File.list(sessionID)
    const sequences = new Set(entries.map(entry => entry.sequence))
    for (const entry of intent.reverting) if (sequences.has(entry.sequence)) {
        if (entry.existed && entry.snapshot) await Bun.write(entry.path, Bun.file(entry.snapshot))
        if (!entry.existed && await Bun.file(entry.path).exists()) await unlink(entry.path)
    }
    if (session.messages.some(message => message.id === intent.position.messageID)) Session.truncate(sessionID, intent.position)
    const remaining = entries.filter(entry => !new Set(intent.reverting.map(item => item.sequence)).has(entry.sequence))
    await Promise.all([Session.rewrite(sessionID), writeFile(Path.checkpoints(sessionID), remaining.length ? `${remaining.map(entry => JSON.stringify(entry)).join('\n')}\n` : '', { mode: 0o600 })])
    await rm(Path.rollback(sessionID), { force: true })
    await Promise.all(intent.reverting.flatMap(entry => entry.snapshot ? [rm(entry.snapshot, { force: true })] : []))
    return true
}

const undo = async (sessionID: string) => {
    const entry = (await File.list(sessionID)).at(-1)
    return entry ? rollback(sessionID, { messageID: entry.messageID, partIndex: entry.partIndex }) : Store.sessions[sessionID] ?? null
}

export default { list: File.list, save: File.save, rollback, recover, undo }
