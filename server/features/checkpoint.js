/* 文件写入前留下快照；rollback 截断历史，undo 恢复 rollback 前现场。 */
import { chmod, mkdir, readFile, rm } from 'node:fs/promises' // 管理快照文件和恢复删除。
import { writeFile } from 'atomically' // 原子更新 checkpoint JSONL。
import Store from '../store.js' // 截断或恢复会话消息真相。
import Path from '../utils/path.js' // 定位会话 undo 日志与快照目录。

let queue = Promise.resolve() // 所有文件快照按发生顺序写入，避免交叉覆盖日志。

const save = (sessionID, position, path) => {
    queue = queue.catch(() => {}).then(async () => { // 上一次失败不能堵住后续 checkpoint。
        const logPath = `${Path.undo(sessionID)}.jsonl` // 每条会话使用独立操作日志。
        const text = await readFile(logPath, 'utf8')
            .catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))
        const items = text.split('\n').filter(Boolean).map(JSON.parse) // 恢复已有写入顺序。
        const sequence = crypto.randomUUID() // 快照文件名与一次写操作绑定。
        await mkdir(Path.undo(sessionID), { recursive: true, mode: 0o700 }) // 确保私有快照目录存在。

        const existed = await Bun.file(path).exists() // 记录写入前文件是否存在。
        if (existed) {
            const snapshot = `${Path.undo(sessionID)}/${sequence}` // 一个写操作对应一个原文件副本。
            await Bun.write(snapshot, Bun.file(path)) // 保存写入前的完整字节。
            await chmod(snapshot, 0o600) // 快照仅当前用户可读写。
        }

        items.push({ type: 'write', sequence, ...position, path, existed }) // 关联消息 part 与文件快照。
        const lines = items.map(JSON.stringify).join('\n') // 操作记录保持可编辑 JSONL。
        await writeFile(logPath, `${lines}\n`, { mode: 0o600 }) // 原子提交新日志。
    })
    return queue // 写工具等待快照完成后才修改文件。
}

const rollback = (sessionID, position) => {
    queue = queue.catch(() => {}).then(async () => { // rollback 与所有写快照保持全局顺序。
        const session = Store.sessions[sessionID] // 回滚会直接截断这条消息历史。
        if (Store.runtimes[sessionID].status !== 'idle') throw new Error('Session must be idle') // 等工具结束。

        const target = session.messages.findIndex(message => message.id === position.messageID) // 定位回滚消息。
        if (!session.messages[target]?.parts[position.partIndex]) throw new Error('Message part not found') // 校验 part。

        const logPath = `${Path.undo(sessionID)}.jsonl` // 读取此会话全部文件变更记录。
        const text = await readFile(logPath, 'utf8')
            .catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))
        const items = text.split('\n').filter(Boolean).map(JSON.parse) // 还原写入与旧回滚记录。
        const writes = items.filter(item => {
            if (item.type !== 'write') return false // rollback 记录本身不参与文件恢复。
            const index = session.messages.findIndex(message => message.id === item.messageID) // 找到写入位置。
            return index > target || index === target && item.partIndex >= position.partIndex // 选择目标之后的写入。
        })

        const files = [] // 保存回滚前的当前文件，供 undo 使用。
        const sequence = crypto.randomUUID() // 本次 rollback 的快照前缀。
        await mkdir(Path.undo(sessionID), { recursive: true, mode: 0o700 }) // 确保 undo 目录存在。
        for (const path of [...new Set(writes.map(item => item.path))]) {
            const existed = await Bun.file(path).exists() // 记录回滚前文件是否存在。
            const snapshot = `${Path.undo(sessionID)}/${sequence}-${files.length}` // 每个当前文件独立快照。
            if (existed) {
                await Bun.write(snapshot, Bun.file(path)) // 保存 undo 需要的回滚前内容。
                await chmod(snapshot, 0o600) // 当前文件快照同样保持私有。
            }
            files.push({ path, existed, snapshot }) // 记录 undo 时如何恢复这个路径。
        }

        const record = {
            type: 'rollback',
            messages: structuredClone(session.messages),
            files,
            removed: writes,
        }
        const history = [...items.filter(item => !writes.includes(item)), record] // 写入记录折叠为一次 rollback。
        const lines = history.map(JSON.stringify).join('\n') // 保持操作历史可直接检查。
        await writeFile(logPath, `${lines}\n`, { mode: 0o600 }) // 先保存 undo 信息再改文件。

        for (const item of writes.toReversed()) {
            if (item.existed) await Bun.write(item.path, Bun.file(`${Path.undo(sessionID)}/${item.sequence}`))
            else await rm(item.path, { force: true }) // 原先不存在的文件应被删除。
        }
        session.messages = session.messages.slice(0, target + 1) // 删除目标消息之后的历史。
        session.messages[target].parts = session.messages[target].parts.slice(0, position.partIndex) // 截断目标 part。
        if (!session.messages[target].parts.length) session.messages.pop() // 不保留空消息。
        await Store.save(sessionID) // 文件和消息恢复后重写 JSONL。
        return session // 返回回滚后的会话给页面。
    })
    return queue // 调用方等待完整回滚完成。
}

const undo = sessionID => {
    queue = queue.catch(() => {}).then(async () => { // undo 也按操作日志顺序执行。
        const logPath = `${Path.undo(sessionID)}.jsonl` // 查找最近一次 rollback。
        const text = await readFile(logPath, 'utf8')
            .catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))
        const items = text.split('\n').filter(Boolean).map(JSON.parse) // 解析当前 undo 历史。
        const index = items.findLastIndex(item => item.type === 'rollback') // 只撤销最近一次回滚。
        if (index < 0) return null // 没有回滚记录时不修改任何内容。

        const record = items[index] // 取出回滚前消息和文件现场。
        for (const item of items.slice(index + 1).filter(item => item.type === 'write').toReversed()) {
            if (item.existed) await Bun.write(item.path, Bun.file(`${Path.undo(sessionID)}/${item.sequence}`))
            else await rm(item.path, { force: true }) // 撤销回滚后新增的文件。
        }
        for (const file of record.files) {
            if (file.existed) await Bun.write(file.path, Bun.file(file.snapshot))
            else await rm(file.path, { force: true }) // 回滚前不存在的路径恢复为不存在。
        }

        Store.sessions[sessionID].messages = structuredClone(record.messages) // 恢复精确消息现场。
        await Store.save(sessionID) // 立即重写会话 JSONL。
        const history = [...items.slice(0, index), ...record.removed] // 还原被 rollback 折叠的写记录。
        const lines = history.map(JSON.stringify).join('\n') // 重建可继续回滚的日志。
        await writeFile(logPath, lines ? `${lines}\n` : '', { mode: 0o600 })
        return Store.sessions[sessionID] // 返回 undo 后的完整会话。
    })
    return queue // 调用方等待消息和文件都恢复。
}

export default { save, rollback, undo } // 暴露写前快照、回滚和撤销。
