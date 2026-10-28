/*
 * 文件快照：工具改文件之前先把原样存一份，回退时能把文件恢复回去。
 *
 * 快照按"工具调用"分组，一次工具调用对应一份文件清单；备份按内容命名，同一份内容只存一次。
 * 分到工具这一级是为了能回退到某一次工具调用之前——比"退回某条消息"细一层，
 * 用户能看到"这个工具把文件改坏了"并只退掉它，不用把整轮对话都丢掉。
 * 回退掉的记录不丢弃，放进 redone 栈里，撤销回退时还能拿回来——所以可以连退回退好几步，
 * 再逐步撤销，直到发新消息才清空。
 * 调用示例：
 *   await Snapshot.save({ sessionId, messageId, toolCallId, toolName, input })  // 工具即将改这些文件，先存一份
 *   Snapshot.entries({ sessionId })                     // 记过哪些工具调用，界面据此列出可回退的点
 *   await Snapshot.restoreToTool({ sessionId, toolCallId })    // 退回这次工具调用之前
 *   await Snapshot.restoreToMessage({ sessionId, keepMessages })  // 退回某条消息之前
 *   await Snapshot.undo({ sessionId })                  // 撤销最近一次回退，文件也恢复
 *   await Snapshot.diff({ sessionId })                  // 这些文件现在和任务开始时有什么不同
 *   await Snapshot.remove({ sessionId })                // 会话删掉时清理
 */

import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import Path from '../utils/path.js'
import Skip from '../utils/skip.js' // 扫工作区时跳过依赖和构建产物。
import Store from '../store.js' // 快照清单跟着会话一起放在内存里。
import fail from '../utils/fail.js' // 回退到一个不存在的工具调用时按填错处理。
import { toolFiles } from '../tool-files.js' // 一次调用会碰哪些文件。

// shell 快照最多看这么多文件、单文件最大这么大；超过就跳过，不把整台机器扫一遍。
const DEFAULT_MAX_FILES = 2000
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

// 正在等结果的 shell 调用：key 是 `${sessionId}:${toolCallId}`，value 是命令执行前的工作区清单。
const shells = new Map()

// 文件指纹缓存：路径 → { size, mtimeMs, hash }，文件没变时不用重新读一遍。
const manifests = new Map()
/** 按文件内容算指纹，同一份内容只备份一次，反复改同一个文件也不会堆出很多份。 */
const fingerprint = async path => {
    const content = await Bun.file(path).arrayBuffer()
    return createHash('sha256').update(Buffer.from(content)).digest('hex')
}

/** 备份文件放在这个会话的快照目录里，文件名就是内容指纹。 */
const backupPath = (sessionId, hash) => join(Path.snapshots(sessionId), hash)

/**
 * 把一个文件现在的样子存进备份区。
 * @param {{ sessionId: string, path: string }} target
 * @returns {Promise<string|null>} 内容指纹；文件不存在时是 null，恢复时据此把它删掉。
 */
const backup = async ({ sessionId, path }) => {
    if (!await Bun.file(path).exists()) return null
    return backupKnown({ sessionId, path, hash: await fingerprint(path) })
}

/**
 * 用已经算好的指纹备份，避免刚算完又算一遍。
 * @param {{ sessionId: string, path: string, hash: string }} target
 * @returns {Promise<string>} 内容指纹。
 */
const backupKnown = async ({ sessionId, path, hash }) => {
    const target = backupPath(sessionId, hash)
    if (!await Bun.file(target).exists()) {
        await mkdir(Path.snapshots(sessionId), { recursive: true })
        await cp(path, target)
    }
    return hash
}

/**
 * 记录一次工具调用即将改动哪些文件。
 * @param {{ sessionId: string, messageId?: string, toolCallId?: string, toolName: string, input: object }} call
 *   模型这次要执行的工具；toolCallId 是它在历史里的唯一身份，回退到工具这一级靠它定位。
 * @returns {Promise<string[]>} 这次新记录的文件绝对路径；不改文件时是空数组。
 */
const save = async ({ sessionId, messageId, toolCallId, toolName, input }) => {
    // 会碰哪些文件由 tool-files.js 一处说了算。
    const paths = toolFiles({ toolName, input })
    if (!paths.length) return [] // list_files、glob、search_files 这些不改文件，不需要快照。

    const store = await loadStore({ sessionId })
    // 一次工具调用可能出现多次（重试、流式），只在第一次记，要留的是它开始之前的样子。
    const id = toolCallId || messageId
    let entry = store.checkpoints.findLast(item => item.id === id)
    if (!entry) {
        entry = { id, messageId, toolCallId, toolName, files: {} }
        store.checkpoints.push(entry)
    }

    const recorded = []
    for (const path of paths) {
        const absolute = resolve(path)
        if (absolute in entry.files) continue // 这次调用已经存过，要留的是它开始时的样子。
        manifests.delete(absolute) // 文件马上要改，下一次统计不要用旧的指纹。

        // 文件还不存在说明这次是新建；回退时应当把它删掉，所以记成 null。
        entry.files[absolute] = await backup({ sessionId, path: absolute })
        recorded.push(absolute)
    }
    await writeStore({ sessionId, store })
    return recorded
}

/**
 * 扫一遍工作区，记下每个文件的指纹；需要时顺手备份。
 * 跳过依赖、构建产物和过大的文件，避免一次 shell 命令把整台机器读一遍。
 * @param {{ sessionId: string, backupFiles?: boolean, maxFiles?: number, maxBytes?: number }} input
 * @returns {Promise<{ skipped: boolean, reason?: string, manifest?: Map<string, string> }>}
 */
const captureWorkspace = async ({ sessionId, backupFiles = false, maxFiles = DEFAULT_MAX_FILES, maxBytes = DEFAULT_MAX_BYTES }) => {
    const root = process.cwd()
    const manifest = new Map()
    for await (const entry of new Bun.Glob('**/*').scan({ cwd: root, onlyFiles: true, dot: true })) {
        const relativePath = entry.replace(/\\/g, '/')
        if (Skip.listing(relativePath)) continue

        const absolute = resolve(root, entry)
        const info = await stat(absolute).catch(() => null)
        if (!info || !info.isFile() || info.size > maxBytes) continue
        if (manifest.size >= maxFiles) return { skipped: true, reason: `文件数超过 ${maxFiles}` }

        let hash
        const cached = manifests.get(absolute)
        if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs && cached.ctimeMs === info.ctimeMs) {
            // 文件没动过，直接用上次的指纹。
            hash = cached.hash
        } else {
            try {
                hash = await fingerprint(absolute)
            } catch {
                continue // 读不了的文件（权限、被占用）跳过，不因为一个文件放弃整次快照。
            }
            manifests.set(absolute, { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, hash })
        }
        if (backupFiles) await backupKnown({ sessionId, path: absolute, hash })
        manifest.set(absolute, hash)
    }
    return { skipped: false, manifest }
}

/**
 * execute_command 执行前：把整个工作区备份一份，等命令结束后再对比。
 * @param {{ sessionId: string, messageId?: string, toolCallId?: string }} call
 * @returns {Promise<{ skipped: boolean, reason?: string, files?: number }>}
 */
const beginShell = async ({ sessionId, messageId, toolCallId } = {}) => {
    // 默认关：扫工作区有成本，用户明确打开才做。
    if (Store.config.snapshot?.shell !== true) return { skipped: true, reason: 'disabled' }
    if (!sessionId || !toolCallId) return { skipped: true, reason: 'no call id' }

    const result = await captureWorkspace({
        sessionId,
        backupFiles: true,
        maxFiles: Number(Store.config.snapshot?.maxFiles) || DEFAULT_MAX_FILES,
        maxBytes: Number(Store.config.snapshot?.maxBytes) || DEFAULT_MAX_BYTES,
    })
    if (result.skipped) return result

    const key = `${sessionId}:${toolCallId}`
    // 万一命令没有结果（进程被杀、任务被停），十五分钟后把这份清单丢掉，不让它一直占内存。
    const timer = setTimeout(() => shells.delete(key), 15 * 60 * 1000)
    timer.unref?.()
    shells.set(key, { manifest: result.manifest, messageId, toolCallId, timer })
    return { skipped: false, files: result.manifest.size }
}

/**
 * execute_command 结束后：和命令前的清单对比，只把真正变过的文件记成一次检查点。
 * @param {{ sessionId: string, toolCallId?: string }} call
 * @returns {Promise<{ skipped: boolean, reason?: string, changed?: number }>}
 */
const endShell = async ({ sessionId, toolCallId } = {}) => {
    const key = `${sessionId}:${toolCallId}`
    const state = shells.get(key)
    if (!state) return { skipped: true, reason: 'no snapshot' }
    shells.delete(key)
    clearTimeout(state.timer)

    const result = await captureWorkspace({
        sessionId,
        maxFiles: Number(Store.config.snapshot?.maxFiles) || DEFAULT_MAX_FILES,
        maxBytes: Number(Store.config.snapshot?.maxBytes) || DEFAULT_MAX_BYTES,
    })
    if (result.skipped) return result

    const files = {}
    // 新增的文件记 null；改过的文件记命令前那份指纹。
    for (const [path, hash] of result.manifest) {
        const before = state.manifest.get(path)
        if (before === undefined) files[path] = null
        else if (before !== hash) files[path] = before
    }
    // 命令删掉的文件也要记下来，回退时才能恢复。
    for (const [path, hash] of state.manifest) {
        if (!result.manifest.has(path)) files[path] = hash
    }
    if (!Object.keys(files).length) return { skipped: false, changed: 0 }

    const store = await loadStore({ sessionId })
    // 同一个工具调用重试时只保留第一次记录。
    if (!store.checkpoints.some(entry => entry.id === toolCallId)) {
        store.checkpoints.push({ id: toolCallId, messageId: state.messageId, toolCallId, toolName: 'execute_command', files })
        await writeStore({ sessionId, store })
    }
    return { skipped: false, changed: Object.keys(files).length }
}

/**
 * 记过哪些工具调用，按发生顺序排列。界面用它列出"可以退回到哪一步"。
 * @param {{ sessionId: string }} session
 * @returns {Array<{ id: string, messageId: string, toolCallId: string, toolName: string, paths: string[] }>}
 *   没碰过文件的工具不会出现在这里。
 */
const entries = ({ sessionId }) => (Store.snapshots.get(sessionId)?.checkpoints || []).map(entry => ({
    id: entry.id,
    messageId: entry.messageId,
    toolCallId: entry.toolCallId,
    toolName: entry.toolName,
    paths: Object.keys(entry.files),
}))

/**
 * 退回某一次工具调用之前：删掉这次调用和它之后的全部记录，把文件恢复成那次调用之前的样子。
 * @param {{ sessionId: string, toolCallId: string }} target
 * @returns {Promise<string[]>} 被恢复的文件绝对路径。
 * @throws {Error} 找不到这次工具调用时按用户填错处理（404）。
 */
const restoreToTool = async ({ sessionId, toolCallId }) => {
    const store = await loadStore({ sessionId })
    const index = store.checkpoints.findIndex(entry => entry.id === toolCallId || entry.toolCallId === toolCallId)
    if (index < 0) throw fail(404, `Tool call not found in snapshots: ${toolCallId}`)

    // 只保留这次调用之前的记录。
    return restore({ sessionId, keepIds: store.checkpoints.slice(0, index).map(entry => entry.id) })
}

/**
 * 退回某条消息之前：删掉从这条消息开始的全部记录。
 * @param {{ sessionId: string, keepMessages: string[] }} target keepMessages 是回退后仍然保留的消息块 id。
 * @returns {Promise<string[]>} 被恢复的文件绝对路径。
 */
const restoreToMessage = async ({ sessionId, keepMessages }) => {
    const store = await loadStore({ sessionId })
    const keepIds = store.checkpoints.filter(entry => keepMessages.includes(entry.messageId)).map(entry => entry.id)
    return restore({ sessionId, keepIds })
}

// --- 丢掉这个会话还在等结果的 shell 快照 ---
const clearShells = sessionId => {
    for (const [key, state] of shells) {
        if (!key.startsWith(`${sessionId}:`)) continue
        clearTimeout(state.timer)
        shells.delete(key)
    }
}

/**
 * 把文件恢复到 keepIds 之后的样子，并把被删掉的记录压进 redone 栈留着撤销。
 * 同一个文件被好几轮改过时，从后往前找最后一次记录，那才是回退点的样子。
 * @param {{ sessionId: string, keepIds: string[] }} target 要保留的记录 id。
 * @returns {Promise<string[]>} 被恢复的文件绝对路径。
 */
const restore = async ({ sessionId, keepIds }) => {
    // 回退时正在跑的 shell 没有意义了，丢掉它等结果的快照。
    clearShells(sessionId)
    const store = await loadStore({ sessionId })
    const dropped = store.checkpoints.filter(entry => !keepIds.includes(entry.id))
    if (!dropped.length) return []
    const kept = store.checkpoints.filter(entry => keepIds.includes(entry.id))

    /*
     * 每个文件取"最早被回退掉的那次记录"里的原样，那才是回退点的状态。
     * 更早的记录属于回退点之前，不能拿来覆盖；否则连续改同一个文件时会退错。
     */
    const wanted = new Map()
    for (const entry of dropped) {
        for (const [path, hash] of Object.entries(entry.files)) {
            if (!wanted.has(path)) wanted.set(path, hash)
        }
    }

    // 恢复之前先把"现在是什么样"存下来，撤销回退时才能把文件还原回去。
    const after = {}
    for (const path of wanted.keys()) after[path] = await backup({ sessionId, path })

    const restored = await writeFiles({ sessionId, wanted })
    store.checkpoints = kept
    store.redone.push({ entries: dropped, after }) // 留着，撤销回退要用。
    await writeStore({ sessionId, store })
    return restored
}

/**
 * 按"路径 → 内容指纹"把文件铺回磁盘；指纹是 null 的表示那个文件当时不存在。
 * @param {{ sessionId: string, wanted: Map<string, string|null> }} plan
 * @returns {Promise<string[]>} 实际写过的路径。
 */
const writeFiles = async ({ sessionId, wanted }) => {
    const restored = []
    for (const [path, hash] of wanted) {
        if (hash === null) {
            await rm(path, { force: true }) // 记的是 null，说明那时还不存在，回退就是把它删掉。
        } else {
            await mkdir(dirname(path), { recursive: true })
            await cp(backupPath(sessionId, hash), path)
        }
        restored.push(path)
        manifests.delete(resolve(path)) // 文件刚被改过，下一次统计重新算指纹。
    }
    return restored
}

/**
 * 撤销最近一次回退：对话和文件一起回到回退之前的样子。
 * @param {{ sessionId: string }} session
 * @returns {Promise<string[]>} 被还原的文件路径；没有可撤销的回退时是空数组。
 */
const undo = async ({ sessionId }) => {
    clearShells(sessionId)
    const store = await loadStore({ sessionId })
    const last = store.redone.pop()
    if (!last) return [] // 没有可撤销的回退时什么也不做。

    // after 里记的是"回退前是什么样"，照它铺回去就等于撤销那次回退。
    const restored = await writeFiles({ sessionId, wanted: new Map(Object.entries(last.after)) })
    store.checkpoints.push(...last.entries)
    await writeStore({ sessionId, store })
    return restored
}

/**
 * 发新消息后，之前的回退不能再撤销：新消息代表新的时间线。
 * @param {{ sessionId: string }} session
 * @returns {Promise<void>}
 */
const clearUndo = async ({ sessionId }) => {
    const store = await loadStore({ sessionId })
    if (!store.redone.length) return
    store.redone = []
    await writeStore({ sessionId, store })
}

/**
 * 这些文件现在和记录时有什么不同，界面据此显示 diff。
 * @param {{ sessionId: string }} session
 * @returns {Promise<Array<{ path: string, before: string, after: string, added: boolean, deleted: boolean }>>}
 *   内容没变过的文件不会出现。
 */
const diff = async ({ sessionId }) => {
    const store = await loadStore({ sessionId })
    const changed = new Map()

    // 每个文件只要最早那份记录：那是这一串改动开始前的样子。
    for (const entry of store.checkpoints) {
        for (const [path, hash] of Object.entries(entry.files)) {
            if (!changed.has(path)) changed.set(path, hash)
        }
    }

    const files = []
    for (const [path, original] of changed) {
        const exists = await Bun.file(path).exists()
        const current = exists ? await fingerprint(path) : null
        // 内容没变就不列出来，用户要看的是"到底改了什么"。
        if (current === original) continue

        const before = original === null ? '' : await Bun.file(backupPath(sessionId, original)).text()
        const after = exists ? await Bun.file(path).text() : ''
        files.push({ path, before, after, added: original === null, deleted: current === null })
    }
    return files
}

/**
 * 读取快照清单，第一次读时从磁盘装进来。
 * @param {{ sessionId: string }} session
 * @returns {Promise<{ checkpoints: object[], redone: object[] }>}
 */
const loadStore = async ({ sessionId }) => {
    if (Store.snapshots.has(sessionId)) return Store.snapshots.get(sessionId)
    const file = Bun.file(Path.checkpoints(sessionId))
    // 第一次运行的会话还没有快照文件，从空清单开始。
    const store = await file.exists() ? await file.json() : { checkpoints: [], redone: [] }
    // 更早版本写的文件里没有 redone 这一项，补上。
    store.redone ||= []
    Store.snapshots.set(sessionId, store)
    return store
}

/** 保存快照清单。 */
const writeStore = async ({ sessionId, store }) => {
    await mkdir(Path.snapshots(sessionId), { recursive: true })
    await Bun.write(Path.checkpoints(sessionId), JSON.stringify(store, null, 2))
}

/**
 * 把某一次工具调用和它之后的记录从清单里去掉，但不动磁盘上的文件。
 * 用户想"这次调用当作没发生、但已经改好的文件留着"时用它。
 * @param {{ sessionId: string, toolCallId: string }} target
 * @returns {Promise<string[]>} 恒定空数组，和其它回退接口保持同一种返回形状。
 * @throws {Error} 找不到这次工具调用时按用户填错处理（404）。
 */
const dropTool = async ({ sessionId, toolCallId }) => {
    const store = await loadStore({ sessionId })
    const index = store.checkpoints.findIndex(entry => entry.id === toolCallId || entry.toolCallId === toolCallId)
    if (index < 0) throw fail(404, `Tool call not found in snapshots: ${toolCallId}`)

    const dropped = store.checkpoints.splice(index)
    store.redone.push({ entries: dropped, after: {} }) // 撤销时把记录放回来，文件本来就没动。
    await writeStore({ sessionId, store })
    return []
}

/**
 * 会话删除时一并清掉快照，备份文件和数据都不留。
 * @param {{ sessionId: string }} session
 * @returns {Promise<void>}
 */
const remove = async ({ sessionId }) => {
    clearShells(sessionId)
    Store.snapshots.delete(sessionId)
    await rm(Path.snapshots(sessionId), { recursive: true, force: true })
    await rm(Path.checkpoints(sessionId), { force: true })
}

export default { save, beginShell, endShell, entries, restoreToTool, restoreToMessage, dropTool, undo, clearUndo, diff, remove }