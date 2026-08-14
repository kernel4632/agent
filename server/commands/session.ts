import { nanoid } from 'nanoid'
import { rm } from 'node:fs/promises'
import Store from '../store.ts'
import Path from '../utils/path.ts'
import Error from '../utils/error.ts'
import Workspace from './workspace.ts'
import File from './session-file.ts'
import type { AgentMessage, CheckpointPosition, SessionData } from '../types.ts'

const load = File.load
const read = (sessionID: string) => Store.sessions[sessionID] ?? null
const save = File.save
const append = File.append
const rewrite = File.rewrite
const truncate = File.truncate

const create = async (workspaceID: string, provider: string, model: string) => {
    const workspace = Store.workspaces[workspaceID]
    if (!workspace) throw Error.notFound('Workspace not found')
    const session: SessionData = { id: nanoid(), workspaceID, provider, model, messages: [] }
    Store.sessions[session.id] = session
    Store.runtimes[session.id] = File.runtime()
    await save(session.id)
    workspace.sessions.push({ id: session.id, title: '', lastActiveAt: new Date().toISOString() })
    await Workspace.save()
    return session
}

const updateNow = async (sessionID: string, patch: Partial<Pick<SessionData, 'provider' | 'model'>>) => {
    const session = read(sessionID)
    if (!session) throw Error.notFound('Session not found')
    if (Store.runtimes[sessionID]!.status === 'running') throw Error.conflict('Cannot update a running session')
    Object.assign(session, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)))
    await save(sessionID)
    return session
}

const update = (sessionID: string, patch: Partial<Pick<SessionData, 'provider' | 'model'>>) => {
    const runtime = Store.runtimes[sessionID]
    if (!runtime) throw Error.notFound('Session not found')
    return runtime.sends.add(() => updateNow(sessionID, patch))
}

const remove = async (sessionID: string) => {
    const session = read(sessionID)
    if (!session) return false
    const runtime = Store.runtimes[sessionID]!
    runtime.closed = true
    await runtime.sends.onIdle()
    if (runtime.status === 'running') { runtime.closed = false; throw Error.conflict('Cannot remove a running session') }
    await runtime.writes.onIdle()
    delete Store.sessions[sessionID]
    const workspace = Store.workspaces[session.workspaceID]
    if (workspace) workspace.sessions = workspace.sessions.filter(summary => summary.id !== sessionID)
    await Promise.all([Workspace.save(), rm(Path.session(sessionID), { recursive: true, force: true })])
    delete Store.runtimes[sessionID]
    return true
}

const touch = async (sessionID: string) => {
    const session = read(sessionID)
    const summary = session && Store.workspaces[session.workspaceID]?.sessions.find(item => item.id === sessionID)
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
