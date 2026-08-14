import { chmod, mkdir, readFile } from 'node:fs/promises'
import { writeFile } from 'atomically'
import PQueue from 'p-queue'
import Store from '../store.ts'
import Path from '../utils/path.ts'
import type { AgentMessage, CheckpointPosition, RuntimeData, SessionData } from '../types.ts'

const runtime = (): RuntimeData => ({
    status: 'idle', abort: new AbortController(), operations: new Map(), operationTasks: new Map(), permission: new Map(), listeners: new Set(),
    events: [], closed: false, sends: new PQueue({ concurrency: 1 }), writes: new PQueue({ concurrency: 1 }),
})

const load = async () => {
    Store.sessions = {}
    Store.runtimes = {}
    for (const workspace of Object.values(Store.workspaces)) for (const summary of workspace.sessions) {
        const metadataFile = await readFile(Path.metadata(summary.id), 'utf8').catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? '' : Promise.reject(error))
        const messagesFile = await readFile(Path.messages(summary.id), 'utf8').catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? '' : Promise.reject(error))
        if (!metadataFile) throw new globalThis.Error(`Missing session metadata: ${summary.id}`)
        let metadata: Omit<SessionData, 'messages'> = { id: summary.id, workspaceID: workspace.id, provider: '', model: '' }
        try { if (metadataFile) metadata = JSON.parse(metadataFile) } catch { throw new globalThis.Error(`Invalid JSON: ${Path.metadata(summary.id)}`) }
        const messages = messagesFile.split('\n').filter(Boolean).map((line, index) => {
            try { return JSON.parse(line) as AgentMessage } catch { throw new globalThis.Error(`Invalid JSONL at ${Path.messages(summary.id)}:${index + 1}`) }
        })
        Store.sessions[summary.id] = { ...metadata, messages }
        Store.runtimes[summary.id] = runtime()
    }
    return Store.sessions
}

const save = async (sessionID: string) => {
    const { messages: _messages, ...metadata } = Store.sessions[sessionID]!
    await mkdir(Path.session(sessionID), { recursive: true, mode: 0o700 })
    await writeFile(Path.metadata(sessionID), JSON.stringify(metadata, null, 2), { mode: 0o600 })
    await chmod(Path.metadata(sessionID), 0o600)
}

const append = (sessionID: string, message: AgentMessage) => Store.runtimes[sessionID]!.writes.add(async () => {
    await mkdir(Path.session(sessionID), { recursive: true, mode: 0o700 })
    const messages = [...Store.sessions[sessionID]!.messages, message]
    await writeFile(Path.messages(sessionID), `${messages.map(item => JSON.stringify(item)).join('\n')}\n`, { mode: 0o600 })
    Store.sessions[sessionID]!.messages.push(message)
})

const rewrite = (sessionID: string) => Store.runtimes[sessionID]!.writes.add(async () => {
    const lines = Store.sessions[sessionID]!.messages.map(message => JSON.stringify(message)).join('\n')
    await writeFile(Path.messages(sessionID), lines ? `${lines}\n` : '', { mode: 0o600 })
    await chmod(Path.messages(sessionID), 0o600)
})

const truncate = (sessionID: string, position: CheckpointPosition) => {
    const session = Store.sessions[sessionID]
    if (!session) throw new globalThis.Error('Session not found')
    const index = session.messages.findIndex(message => message.id === position.messageID)
    if (index < 0) throw new globalThis.Error('Message not found')
    session.messages = session.messages.slice(0, index + 1)
    session.messages[index]!.parts = session.messages[index]!.parts.slice(0, position.partIndex)
    if (!session.messages[index]!.parts.length) session.messages.pop()
    return session
}

export default { runtime, load, save, append, rewrite, truncate }
