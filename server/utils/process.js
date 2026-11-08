/*
 * 后台进程登记：把一条命令放进后台跑，进程表和日志文件都归这里管。
 *
 * 前台和后台走同一条路（spawnTracked）：输出统一重定向到数据目录 processes/ 下的日志文件。
 * 为什么前台也写文件而不是 pipe：execute_command 到点没跑完时要“交棒”给后台，
 * 必须保留已经产生的输出；pipe 只能读一次，读过的内容回不来，写文件则前后两边看到的是同一份。
 * 另外实测 cmd.exe 包装的 pipe 要等进程退出才 flush，直接写文件也是唯一实时的路子。
 *
 * 进程表只在内存里，重启后端即清空（server.js 启动时挂 cleanup）；磁盘上残留的
 * 日志还能看，但进程已不属于这个后端。每个进程一个 4 位短 id，引用起来不费 token。
 *
 * 调用示例：
 *   const { id, pid, logFile } = await spawnDetached({ command: 'bun test', cwd })
 *   const { running, output } = await readLog(id, 200, { waitFor: 'Listening on', waitMs: 10000 })
 *   await stopProcess(id)               // 整棵杀掉并清日志
 *   cleanup()                           // 后端退出时带走全部孤儿进程
 */

import { mkdir, rm } from 'node:fs/promises'
import { openSync, closeSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import Path from './path.js'

// 运行中的进程表：id → { child, fd, logFile, command, cwd, startedAt }。不能进 store，重启即清。
const running = new Map()

const newId = () => {
    for (;;) {
        const id = crypto.randomUUID().slice(0, 4)
        if (!running.has(id)) return id
    }
}

// --- 结束一个进程：Windows 上按进程树整棵杀（孙进程握着文件句柄会妨碍日志读取） ---
const killTree = pid => {
    try {
        if (process.platform === 'win32') execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
        else process.kill(-pid, 'SIGKILL')
    } catch { /* 进程已经自己退了，不算失败 */ }
}

// --- 起一个进程并登记进进程表，stdout/stderr 都写日志文件 ---
// 前台和后台共用这一个入口。
const spawnTracked = async ({ command, workdir }) => {
    const id = newId()
    await mkdir(Path.processes(), { recursive: true })
    const logFile = join(Path.processes(), `${id}.log`)
    const fd = openSync(logFile, 'a')                                // 子进程直接写这个文件，输出实时可见
    const child = Bun.spawn({
        cmd: process.platform === 'win32'
            ? ['cmd.exe', '/d', '/s', '/c', command]
            : ['sh', '-c', command],
        cwd: workdir,
        detached: process.platform !== 'win32',
        stdout: fd,
        stderr: fd,
    })
    const entry = { child, fd, logFile, command, cwd: workdir, startedAt: Date.now() }
    running.set(id, entry)
    // 进程退了自己关掉句柄；不清表——list 还要能看最后一眼退出码。
    child.exited.then(() => {
        try { closeSync(fd) } catch { /* 已关 */ }
    }, () => {})
    return { id, pid: child.pid, logFile, command, cwd: workdir, child, entry }
}

// --- 把一条命令放进后台执行；后台进程也走会话目录 ---
const spawnDetached = async ({ command, cwd }, options = {}) => {
    options.abortSignal?.throwIfAborted()
    if (typeof command !== 'string' || !command.trim()) throw new Error('command is required')
    const base = options.cwd || process.cwd()
    const workdir = cwd ? (isAbsolute(cwd) ? cwd : resolve(base, cwd)) : base
    const { id, pid, logFile, command: line } = await spawnTracked({ command, workdir })
    return { id, pid, logFile, command: line, cwd: workdir }
}

// --- 前台命令结束后销号并清日志；结果已经读走，不需要留着 ---
const releaseTracked = async id => {
    const entry = running.get(id)
    if (!entry) return
    running.delete(id)
    try { closeSync(entry.fd) } catch { /* 已关 */ }
    await rm(entry.logFile, { force: true }).catch(() => {})
}

// --- 同步读日志全文；没写出来时给空串 ---
const readText = file => {
    try {
        return readFileSync(file, 'utf8')
    } catch {
        return ''
    }
}

// 工具层要读自己进程的输出，不经过 id 查表。
const readTextFile = readText

// --- 读日志：默认给尾巴（最新的在最下面），文件不存在或为空就是还没有输出 ---
// 可选等待：waitMs > 0 时不再立刻返回，而是等到有新输出、或 waitFor 出现、或超时。
// 有 waitFor 时只认“新出现的那一段”：服务早就打印过的旧内容不该让第二次调用秒返回。
const readLog = async (id, tail = 200, options = {}) => {
    const entry = running.get(id)
    if (!entry) throw new Error(`Process not found: ${id}（可能已经停止，或后端重启过）`)

    const waitMs = Math.min(60000, Math.max(0, Math.floor(Number(options.waitMs) || 0)))
    const pattern = typeof options.waitFor === 'string' && options.waitFor ? options.waitFor.toLowerCase() : ''
    const size = Math.max(1, Math.min(2000, Math.floor(Number(tail) || 200)))
    const startedAt = Date.now()
    const initial = readText(entry.logFile)

    // 等待条件：有新输出（且出现了 waitFor，如果指定了），或者进程自己退了。
    // 进程退了就没什么可等的，直接返回，让模型看到退出码。
    let waited = false
    let matched = false
    if (waitMs > 0) {
        waited = true
        while (Date.now() - startedAt < waitMs) {
            if (options.abortSignal?.aborted) break
            // 先看内容再看退出：进程可能打了一行就退，先 break 会丢掉这一行。
            const fresh = readText(entry.logFile).slice(initial.length)
            if (fresh) {
                if (!pattern) break                                     // 只等“有新输出”
                if (fresh.toLowerCase().includes(pattern)) { matched = true; break }
            }
            if (entry.child.exitCode != null) break
            await Bun.sleep(50)
        }
    }

    const exited = entry.child.exitCode != null
    const output = readText(entry.logFile)
    const lines = output ? output.split('\n').slice(-size).join('\n') : ''
    const result = { id, running: !exited, output: lines || '(还没有输出)' }
    if (exited) result.exitCode = entry.child.exitCode
    if (waited) {
        result.waitedMs = Date.now() - startedAt
        // 明说为什么停下：命中 / 超时 / 进程退了。模型据此决定继续等还是换做法。
        if (pattern) result.matched = matched
        if (!pattern && output.length === initial.length && !exited) result.timedOut = true
        if (pattern && !matched && !exited) result.timedOut = true
    }
    return result
}

// --- 列出在跑的进程；刚退出的还在表里（exitCode 有值），方便看最后一眼 ---
const list = () => [...running.entries()].map(([id, entry]) => ({
    id,
    pid: entry.child.pid,
    command: entry.command,
    cwd: entry.cwd,
    startedAt: entry.startedAt,
    exited: entry.child.exitCode != null,
    exitCode: entry.child.exitCode,
}))

// --- 停止一个进程：整棵杀掉、关掉文件句柄、清掉日志文件 ---
const stopProcess = async id => {
    const entry = running.get(id)
    if (!entry) throw new Error(`Process not found: ${id}`)
    killTree(entry.child.pid)
    try { closeSync(entry.fd) } catch { /* 已关 */ }
    running.delete(id)
    await rm(entry.logFile, { force: true })
    return { id, stopped: true }
}

// --- 后端退出时把还挂着的进程带走，不留孤儿；日志文件一并清掉，行为和 stop 一致 ---
const cleanup = () => {
    for (const entry of running.values()) {
        killTree(entry.child.pid)
        try { closeSync(entry.fd) } catch { /* 已关 */ }
        rm(entry.logFile, { force: true }).catch(() => {})
    }
    running.clear()
}

export { running, spawnDetached, spawnTracked, releaseTracked, readLog, readTextFile, list, stopProcess, cleanup, killTree }
