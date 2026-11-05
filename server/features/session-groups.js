/*
 * 会话分组：最多一层分组，一个会话只属于一个分组。
 *
 * 数据形状：{ groups: [{ id, name, sessions: [sessionId] }] }
 * 数组顺序就是界面顺序；不在任何分组里的会话归入“未分组”。
 * 调用示例：
 *   await SessionGroups.read()
 *   await SessionGroups.save({ groups: [...] })
 */

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically'
import Path from '../utils/path.js'
import fail from '../utils/fail.js'

const ID = /^[A-Za-z0-9_-]{1,64}$/
const MAX_GROUPS = 100
const MAX_NAME = 40

let state = null
let writing = Promise.resolve()

const normalize = raw => {
    const input = Array.isArray(raw?.groups) ? raw.groups : []
    if (input.length > MAX_GROUPS) throw fail(400, `too many session groups (max ${MAX_GROUPS})`)
    const groups = []
    const ids = new Set()
    const names = new Set()
    const sessions = new Set()
    for (const item of input) {
        if (!item || typeof item !== 'object') throw fail(400, 'session group must be an object')
        const id = String(item.id || '')
        const name = String(item.name || '').trim()
        if (!ID.test(id)) throw fail(400, 'session group id is invalid')
        if (!name || [...name].length > MAX_NAME) throw fail(400, `session group name must be 1-${MAX_NAME} characters`)
        if (ids.has(id)) throw fail(400, `duplicate session group id: ${id}`)
        if (names.has(name)) throw fail(400, `duplicate session group name: ${name}`)
        ids.add(id)
        names.add(name)
        const groupSessions = []
        for (const sessionId of Array.isArray(item.sessions) ? item.sessions : []) {
            if (typeof sessionId !== 'string' || !sessionId) throw fail(400, 'session group contains an invalid session id')
            if (sessions.has(sessionId)) throw fail(400, `session belongs to more than one group: ${sessionId}`)
            sessions.add(sessionId)
            groupSessions.push(sessionId)
        }
        groups.push({ id, name, sessions: groupSessions })
    }
    return { groups }
}

const read = async () => {
    if (state) return state
    const file = Path.sessionGroups()
    if (!await Bun.file(file).exists()) {
        state = { groups: [] }
        return state
    }
    state = normalize(await Bun.file(file).json())
    return state
}

const persist = async next => {
    const file = Path.sessionGroups()
    writing = writing.catch(() => {}).then(async () => {
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, JSON.stringify(next, null, 2))
    })
    await writing
}

const save = async input => {
    const next = normalize(input)
    state = next
    await persist(next)
    return state
}

const removeSession = async sessionId => {
    const current = await read()
    let changed = false
    const groups = current.groups.map(group => {
        if (!group.sessions.includes(sessionId)) return group
        changed = true
        return { ...group, sessions: group.sessions.filter(id => id !== sessionId) }
    })
    if (!changed) return current
    return save({ groups })
}

const clear = () => {
    state = null
    writing = Promise.resolve()
}

export default { read, save, removeSession, clear }
