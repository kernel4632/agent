/*
 * 文件快照：工具改文件之前先把原样存一份，回退时能把文件恢复回去。
 *
 * 快照按"消息块"分组，一个消息块对应一份文件清单；备份按内容命名，同一份内容只存一次。
 * 调用示例：
 *   await Snapshot.save({ sessionId, messageId, toolName, input })   // 工具即将改这些文件，先存一份
 *   await Snapshot.restore({ sessionId, keep })                      // keep 是回退后还留下的消息块 id
 *   await Snapshot.remove({ sessionId })                             // 会话删掉时清理
 */

import { cp, mkdir, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import Path from '../utils/path.js'
import Store from '../store.js' // 快照清单跟着会话一起放在内存里。

// --- 内容指纹 ---
const fingerprint = async path => {
    // 按文件内容算指纹，同一份内容只备份一次，反复改同一个文件也不会堆出很多份。
    const content = await Bun.file(path).arrayBuffer()
    return createHash('sha256').update(Buffer.from(content)).digest('hex')
}

// --- 备份文件放在哪 ---
const backupPath = (sessionId, hash) => join(Path.snapshots(sessionId), hash)

// --- 工具会改哪些文件 ---
const pathsOf = ({ toolName, input }) => {
    // 补丁工具的参数是 patches 数组，其余文件工具是单个 path。
    if (toolName === 'apply_patch') return (input?.patches || []).map(patch => patch.path).filter(Boolean)
    return input?.path ? [input.path] : []
}

// --- 记录快照清单 ---
const save = async ({ sessionId, messageId, toolName, input }) => {
    const paths = pathsOf({ toolName, input })
    if (!paths.length) return [] // file_list、glob、grep 这些不改文件，不需要快照。

    const store = await loadStore({ sessionId })
    // 这个会话之前没有本消息块的记录时现建一份；有的轮次不改文件，所以这里不能假设已经有了。
    let entry = store.checkpoints.findLast(item => item.messageId === messageId)
    if (!entry) {
        entry = { messageId, files: {} }
        store.checkpoints.push(entry)
    }

    const recorded = []
    for (const path of paths) {
        const absolute = resolve(path)
        if (absolute in entry.files) continue // 本轮已经存过，要留的是这一轮开始时的样子。

        const exists = await Bun.file(absolute).exists()
        // 文件还不存在说明这次是新建；回退时应当把它删掉，所以记成 null。
        entry.files[absolute] = exists ? await fingerprint(absolute) : null
        if (exists) {
            const target = backupPath(sessionId, entry.files[absolute])
            if (!await Bun.file(target).exists()) {
                await mkdir(Path.snapshots(sessionId), { recursive: true })
                await cp(absolute, target)
            }
        }
        recorded.push(absolute)
    }
    await writeStore({ sessionId, store })
    return recorded
}

// --- 把文件恢复到回退点之前 ---
const restore = async ({ sessionId, keep }) => {
    const store = await loadStore({ sessionId })
    // keep 是回退后仍然保留的消息块 id；不在里面的记录都属于被回退掉的那一段。
    const dropped = store.checkpoints.filter(entry => !keep.includes(entry.messageId))
    if (!dropped.length) return []
    const kept = store.checkpoints.filter(entry => keep.includes(entry.messageId))

    // 同一个文件可能被好几轮改过，从后往前找最后一次记录，那才是回退点的样子。
    const wanted = new Map()
    for (const entry of [...dropped].reverse()) {
        for (const [path, hash] of Object.entries(entry.files)) {
            if (!wanted.has(path)) wanted.set(path, hash)
        }
    }
    // 被回退掉的轮次里改过、但更早的轮次也留下记录的文件，要用更早那份覆盖回来。
    for (const entry of [...kept].reverse()) {
        for (const [path, hash] of Object.entries(entry.files)) wanted.delete(path)
    }

    const restored = []
    for (const [path, hash] of wanted) {
        if (hash === null) {
            await rm(path, { force: true }) // 这一轮开始时还不存在，回退就是把它删掉。
        } else {
            await mkdir(dirname(path), { recursive: true })
            await cp(backupPath(sessionId, hash), path)
        }
        restored.push(path)
    }

    store.checkpoints = kept
    await writeStore({ sessionId, store })
    return restored
}

// --- 读取快照清单 ---
const loadStore = async ({ sessionId }) => {
    if (Store.snapshots.has(sessionId)) return Store.snapshots.get(sessionId)
    const file = Bun.file(Path.checkpoints(sessionId))
    // 第一次运行的会话还没有快照文件，从空清单开始。
    const store = await file.exists() ? await file.json() : { checkpoints: [] }
    Store.snapshots.set(sessionId, store)
    return store
}

// --- 保存快照清单 ---
const writeStore = async ({ sessionId, store }) => {
    await mkdir(Path.snapshots(sessionId), { recursive: true })
    await Bun.write(Path.checkpoints(sessionId), JSON.stringify(store, null, 2))
}

// --- 会话删除时一并清掉快照 ---
const remove = async ({ sessionId }) => {
    Store.snapshots.delete(sessionId)
    await rm(Path.snapshots(sessionId), { recursive: true, force: true })
    await rm(Path.checkpoints(sessionId), { force: true })
}

export default { save, restore, remove }
