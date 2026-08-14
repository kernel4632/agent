/*
会话指令：加载并管理模型会话、消息和运行状态。
消息正文保存在会话 JSONL 中，工作区只持有会话标题和最后活动时间。
*/
import { chmod, mkdir, readFile, rm } from 'node:fs/promises'
import { writeFile } from 'atomically'
import { nanoid } from 'nanoid'
import Store from '../store.ts'
import Path from '../utils/path.ts'
import Error from '../utils/error.ts'
import Workspace from './workspace.ts'
import type { AgentMessage, CheckpointPosition, SessionData } from '../types.ts'

const load = async () => {
    Store.sessions = {}
    Store.runtimes = {}
    for (const workspace of Object.values(Store.workspaces)) {
        for (const summary of workspace.sessions) {
            const metadataFile = await readFile(Path.metadata(summary.id), 'utf8').catch(error => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
                throw error
            })
            const messagesFile = await readFile(Path.messages(summary.id), 'utf8').catch(error => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
                throw error
            })
            let metadata: Omit<SessionData, 'messages'> = { id: summary.id, workspaceID: workspace.id, provider: '', model: '' }
            try {
                if (metadataFile) metadata = JSON.parse(metadataFile)
            } catch {
                throw new globalThis.Error(`Invalid JSON: ${Path.metadata(summary.id)}`)
            }
            const messages = messagesFile.split('\n').filter(Boolean).map((line, index) => {
                try {
                    return JSON.parse(line) as AgentMessage
                } catch {
                    throw new globalThis.Error(`Invalid JSONL at ${Path.messages(summary.id)}:${index + 1}`)
                }
            })
            Store.sessions[summary.id] = { ...metadata, messages }
            Store.runtimes[summary.id] = {
                status: 'idle', abort: new AbortController(), tools: new Map(), permission: new Map(), listeners: new Set(), lock: Promise.resolve(),
            }
        }
    }
    return Store.sessions
}

const read = (sessionID: string) => Store.sessions[sessionID] ?? null

const save = async (sessionID: string) => {
    const { messages: _messages, ...metadata } = Store.sessions[sessionID]!
    await mkdir(Path.session(sessionID), { recursive: true, mode: 0o700 })
    await writeFile(Path.metadata(sessionID), JSON.stringify(metadata, null, 2), { mode: 0o600 })
    await chmod(Path.metadata(sessionID), 0o600)
}

const append = async (sessionID: string, message: AgentMessage) => {
    await mkdir(Path.session(sessionID), { recursive: true, mode: 0o700 })
    const messages = [...Store.sessions[sessionID]!.messages, message]
    await writeFile(Path.messages(sessionID), `${messages.map(item => JSON.stringify(item)).join('\n')}\n`, { mode: 0o600 })
    Store.sessions[sessionID]!.messages.push(message)
}

const rewrite = async (sessionID: string) => {
    const lines = Store.sessions[sessionID]!.messages.map(message => JSON.stringify(message)).join('\n')
    await writeFile(Path.messages(sessionID), lines ? `${lines}\n` : '', { mode: 0o600 })
    await chmod(Path.messages(sessionID), 0o600)
}

const truncate = (sessionID: string, position: CheckpointPosition) => {
    const session = Store.sessions[sessionID]
    if (!session) throw Error.notFound('Session not found')
    const messageIndex = session.messages.findIndex(message => message.id === position.messageID)
    if (messageIndex < 0) throw Error.notFound('Message not found')
    session.messages = session.messages.slice(0, messageIndex + 1)
    session.messages[messageIndex]!.parts = session.messages[messageIndex]!.parts.slice(0, position.partIndex)
    if (!session.messages[messageIndex]!.parts.length) session.messages.pop()
    return session
}

const create = async (workspaceID: string, provider: string, model: string) => {
    const workspace = Store.workspaces[workspaceID]
    if (!workspace) throw Error.notFound('Workspace not found')
    const session: SessionData = { id: nanoid(), workspaceID, provider, model, messages: [] }
    Store.sessions[session.id] = session
    Store.runtimes[session.id] = {
        status: 'idle', abort: new AbortController(), tools: new Map(), permission: new Map(), listeners: new Set(), lock: Promise.resolve(),
    }
    await save(session.id)
    workspace.sessions.push({ id: session.id, title: '', lastActiveAt: new Date().toISOString() })
    await Workspace.save()
    return session
}

const update = async (sessionID: string, patch: Partial<Pick<SessionData, 'provider' | 'model'>>) => {
    const session = read(sessionID)
    if (!session) throw Error.notFound('Session not found')
    if (Store.runtimes[sessionID]!.status === 'running') throw Error.conflict('Cannot update a running session')
    Object.assign(session, patch)
    await save(sessionID)
    return session
}

const remove = async (sessionID: string) => {
    const session = read(sessionID)
    if (!session) return false
    if (Store.runtimes[sessionID]!.status === 'running') throw Error.conflict('Cannot remove a running session')
    delete Store.sessions[sessionID]
    const workspace = Store.workspaces[session.workspaceID]
    if (workspace) workspace.sessions = workspace.sessions.filter(summary => summary.id !== sessionID)
    await Promise.all([Workspace.save(), rm(Path.session(sessionID), { recursive: true, force: true })])
    delete Store.runtimes[sessionID]
    return true
}

const touch = async (sessionID: string) => {
    const session = read(sessionID)
    if (!session) return
    const summary = Store.workspaces[session.workspaceID]?.sessions.find(item => item.id === sessionID)
    if (!summary) return
    summary.lastActiveAt = new Date().toISOString()
    await Workspace.save()
}

const rename = async (sessionID: string, title: string) => {
    const session = read(sessionID)
    if (!session) throw Error.notFound('Session not found')
    const summary = Store.workspaces[session.workspaceID]!.sessions.find(item => item.id === sessionID)!
    summary.title = title
    await Workspace.save()
    return summary
}

export default { load, read, save, append, rewrite, truncate, create, update, remove, touch, rename }
