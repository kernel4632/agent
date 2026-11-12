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

const ID = /^[A-Za-z0-9_-]{1,64}$/         // 分组 id：安全字符，能当文件夹名
const MAX_GROUPS = 100                      // 上限防有人往里塞上千个分组把界面拉爆
const MAX_NAME = 40

let state = null                            // 内存缓存：读完一次就不再读磁盘
let writing = Promise.resolve()             // 写串行队列：同时写两份会互相覆盖

const normalize = raw => {
    const input = Array.isArray(raw?.groups) ? raw.groups : []
    if (input.length > MAX_GROUPS) throw fail(400, `too many session groups (max ${MAX_GROUPS})`)
    const groups = []
    const ids = new Set()                  // 查重：同一批里不能出现两个相同 id
    const names = new Set()                // 查重：名字也不能重复，否则界面分不清
    const sessions = new Set()             // 查重：一个会话只能属于一个分组
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
    if (state) return state                // 有缓存就直接用，不必再读磁盘
    const file = Path.sessionGroups()
    if (!await Bun.file(file).exists()) { // 还没建过分组文件，按空处理
        state = { groups: [] }
        return state
    }
    state = normalize(await Bun.file(file).json())  // 读磁盘并校验，坏的按校验报错
    return state
}

// 写磁盘串行化：上一个写还没落盘时，下一个在 writing 链里排队等。
// 不串行会互相覆盖：两个 save 同时执行，后写的可能先完成，先写的反而覆盖了它。
const persist = async next => {
    const file = Path.sessionGroups()
    writing = writing.catch(() => {}).then(async () => {  // catch 住前一次的失败，不让它挂住后面的写
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, JSON.stringify(next, null, 2))
    })
    await writing
}

const save = async input => {
    const next = normalize(input)          // 先校验，坏了在这里报错，不写进磁盘
    state = next                            // 内存立即更新，后续 read 直接拿到新值
    await persist(next)
    return state
}

// 删除会话时调用：把这条会话从它所在的分组里摘掉，分组本身不动
const remove = async sessionId => {
    const current = await read()
    let changed = false
    const groups = current.groups.map(group => {
        if (!group.sessions.includes(sessionId)) return group
        changed = true
        return { ...group, sessions: group.sessions.filter(id => id !== sessionId) }
    })
    if (!changed) return current            // 这条会话不在任何分组里，不用写盘
    return save({ groups })
}

// 测试用：清掉缓存，下一个测试用例重新从磁盘读
const clear = () => {
    state = null
    writing = Promise.resolve()
}

export default { read, save, remove, clear }
