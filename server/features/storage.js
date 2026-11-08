/*
会话数据目录：把不断变大的 sessions/ 单独放到其他磁盘，配置和工具仍留在 AGENT_HOME。
指针和迁移标记都放在原数据目录，启动时在打开会话前完成复制；不做运行中热切换。

调用示例：
  await Storage.prepare()                 // 服务启动时最先调用
  Storage.status()                        // 当前路径、待迁移路径和错误
  await Storage.setPath('D:\\AgentSessions') // 写入待迁移标记，重启后执行
  await Storage.cancel()                  // 取消尚未执行的迁移
*/
import { access, cp, mkdir, readdir, rm, rename, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'
import Path from '../utils/path.js'
import fail from '../utils/fail.js'
import Fs from '../utils/fs.js'

// 存在性、JSON 读写、子目录判断都走共用实现：这几个函数以前在本文件里
// 各写过一份，与 skills.js / filesystem.js 的版本只是字面不同。
const exists = Fs.exists
const readJSON = Fs.readJson
const writeJSON = Fs.writeJson

const isDirectory = Fs.isDirectory
const same = (first, second) => Path.samePath(first, second)

const countFiles = async root => {
    if (!await exists(root)) return 0
    let total = 0
    const pending = [root]
    while (pending.length) {
        const current = pending.pop()
        for (const entry of await readdir(current, { withFileTypes: true })) {
            if (entry.isDirectory()) pending.push(join(current, entry.name))
            else if (entry.isFile()) total += 1
        }
    }
    return total
}

// 子目录判断：用 relative 而不是字符串前缀，否则 /a/bc 会被当成 /a/b 的子目录。
// 这里不含相等（目标就是当前目录不算“在它里面”）。
const inside = Fs.within

const clearEmptyTarget = async path => {
    if (!await exists(path)) return
    if (!await isDirectory(path)) throw fail(409, '目标路径不是文件夹')
    if ((await readdir(path)).length) throw fail(409, '目标文件夹不是空的；请选择一个空目录')
    await rm(path, { recursive: true, force: true })
}

let lastError = ''
let lastMove = null

const writePointer = async path => {
    await writeJSON(Path.sessionsPathFile(), { path })
}

const writeFailed = async (move, error) => {
    lastError = error.message
    await writeJSON(Path.sessionsMoveFailedFile(), { ...move, error: error.message, failedAt: new Date().toISOString() })
    await rm(Path.sessionsMoveFile(), { force: true })
}

const finishMove = async move => {
    if (!move?.from || !move?.to) throw new Error('迁移标记缺少源目录或目标目录')
    if (!await exists(move.from)) {
        await clearEmptyTarget(move.to)
        await mkdir(move.to, { recursive: true })
    } else {
        // 上次进程可能已经复制完并 rename，只差写指针；文件数一致时直接收尾。
        if (await isDirectory(move.to) && (await readdir(move.to)).length) {
            const sourceCount = await countFiles(move.from)
            const targetCount = await countFiles(move.to)
            if (sourceCount !== targetCount) throw new Error('目标目录已有数据，无法确认上次迁移是否完成')
        } else {
            await clearEmptyTarget(move.to)
            const staging = `${move.to}.migrating`
            await rm(staging, { recursive: true, force: true })
            await mkdir(dirname(move.to), { recursive: true })
            await cp(move.from, staging, { recursive: true, errorOnExist: true, force: false })
            const sourceCount = await countFiles(move.from)
            const targetCount = await countFiles(staging)
            if (sourceCount !== targetCount) throw new Error(`迁移后文件数量不一致（${sourceCount} → ${targetCount}）`)
            await rename(staging, move.to)
        }
    }
    await writePointer(move.to)
    await rm(Path.sessionsMoveFile(), { force: true })
    lastMove = { from: move.from, to: move.to, at: new Date().toISOString() }
    lastError = ''
    return move.to
}

// --- 服务启动时最先解析数据目录 ---
const prepare = async () => {
    const env = process.env.AGENT_SESSIONS
    if (env) {
        Path.setSessions(env)
        await mkdir(Path.sessions(), { recursive: true })
        return { source: 'env', path: Path.sessions() }
    }

    const pointer = await readJSON(Path.sessionsPathFile())
    const move = await readJSON(Path.sessionsMoveFile())
    if (pointer?.path) {
        if (await isDirectory(pointer.path)) Path.setSessions(pointer.path)
        else lastError = `会话数据目录不可用：${pointer.path}`
    }

    if (move) {
        // 迁移期间先使用旧目录；复制成功后再把当前进程切到新目录。
        if (move.from && await isDirectory(move.from)) Path.setSessions(move.from)
        try {
            const target = await finishMove(move)
            Path.setSessions(target)
        } catch (error) {
            await writeFailed(move, error).catch(() => {})
            lastError = error.message
            if (pointer?.path && await isDirectory(pointer.path)) Path.setSessions(pointer.path)
        }
    }

    await mkdir(Path.sessions(), { recursive: true })
    return { source: move ? 'moved' : pointer?.path ? 'pointer' : 'default', path: Path.sessions() }
}

const status = async () => {
    const pending = await readJSON(Path.sessionsMoveFile())
    const failed = await readJSON(Path.sessionsMoveFailedFile())
    return {
        path: Path.sessions(),
        defaultPath: join(Path.root(), 'sessions'),
        envOverride: Boolean(process.env.AGENT_SESSIONS),
        pending: pending?.to ? { from: pending.from, path: pending.to } : null,
        error: lastError || failed?.error || '',
        lastMove,
    }
}

const setPath = async value => {
    if (process.env.AGENT_SESSIONS) throw fail(409, '会话目录由 AGENT_SESSIONS 环境变量控制，不能在界面修改')
    const requested = String(value || '').trim()
    if (!requested) throw fail(400, '请填写会话数据目录')
    if (!isAbsolute(requested)) throw fail(400, '会话数据目录必须是绝对路径')

    const target = resolve(requested)
    const current = resolve(Path.sessions())
    const root = resolve(Path.root())
    if (same(target, current)) throw fail(400, '新目录和当前目录相同')
    if (same(target, root) || inside(current, target) || inside(target, current)) throw fail(400, '新目录不能是当前会话目录或其子目录')
    if (same(target, resolve(Path.userHome())) || same(target, parse(target).root)) throw fail(400, '不能把会话数据放在用户主目录或磁盘根目录')

    await mkdir(dirname(target), { recursive: true })
    await clearEmptyTarget(target)
    await mkdir(target, { recursive: true })
    await access(target)

    const move = { from: current, to: target, createdAt: new Date().toISOString() }
    await writeJSON(Path.sessionsMoveFile(), move)
    await rm(Path.sessionsMoveFailedFile(), { force: true })
    lastError = ''
    return { path: current, pending: { from: current, path: target } }
}

const cancel = async () => {
    await rm(Path.sessionsMoveFile(), { force: true })
    return { ok: true }
}

export default { prepare, status, setPath, cancel, finishMove, writePointer }
