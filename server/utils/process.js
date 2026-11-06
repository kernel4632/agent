/*
 * 后台进程登记：把一条命令放进后台跑，进程表和日志文件都归这里管。
 *
 * 谁要用后台执行谁来这里起：tools/background.js 的独立工具、execute_command 的
 * background 参数，都用同一张表、同一个日志目录、同一套清理。进程直接把
 * stdout/stderr 写到数据目录 processes/ 下的日志文件——实测 cmd.exe 包装的管道
 * 要等进程退出才 flush，直接写文件是唯一实时的路子。
 *
 * 进程表只在内存里，重启后端即清空（server.js 启动时挂 cleanup）；磁盘上残留的
 * 日志还能看，但进程已不属于这个后端。每个进程一个 4 位短 id，引用起来不费 token。
 *
 * 调用示例：
 *   const { id, pid, logFile } = await spawnDetached({ command: 'bun test', cwd })
 *   const { running, output } = await readLog(id, 200)
 *   await stopProcess(id)               // 整棵杀掉并清日志
 *   cleanup()                           // 后端退出时带走全部孤儿进程
 *
 * model-visible id：list() 返回的每条带 id 字段，模型拿它去 log/stop。
 */

import { mkdir, rm } from 'node:fs/promises'
import { openSync, closeSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'
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
        else process.kill(pid)
    } catch { /* 进程已经自己退了，不算失败 */ }
}

// --- 把一条命令放进后台执行；后台进程也走会话目录 ---
const spawnDetached = async ({ command, cwd }, options = {}) => {
    if (typeof command !== 'string' || !command.trim()) throw new Error('command is required')
    const base = options.cwd || process.cwd()
    const workdir = cwd ? (isAbsolute(cwd) ? cwd : resolve(base, cwd)) : base

    const id = newId()
    await mkdir(Path.processes(), { recursive: true })
    const logFile = join(Path.processes(), `${id}.log`)
    const fd = openSync(logFile, 'a')                                // 子进程直接写这个文件，输出实时可见
    const child = Bun.spawn({
        cmd: process.platform === 'win32'
            ? ['cmd.exe', '/d', '/s', '/c', command]
            : ['sh', '-c', command],
        cwd: workdir,
        stdout: fd,
        stderr: fd,
    })
    running.set(id, { child, fd, logFile, command, cwd: workdir, startedAt: Date.now() })

    return { id, pid: child.pid, logFile, command, cwd: workdir }
}

// --- 读日志：默认给尾巴（最新的在最下面），文件不存在或为空就是还没有输出 ---
const readLog = async (id, tail = 200) => {
    const entry = running.get(id)
    if (!entry) throw new Error(`Process not found: ${id}（可能已经停止，或后端重启过）`)
    const exited = entry.child.exitCode != null

    let output = ''
    try {
        const lines = readFileSync(entry.logFile, 'utf8').split('\n')
        output = lines.slice(-Math.max(1, Math.min(2000, Math.floor(Number(tail) || 200)))).join('\n')
    } catch { /* 文件还没被写出来；输出保持空 */ }
    return { id, running: !exited, output: output || '(还没有输出)' }
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
    closeSync(entry.fd)
    running.delete(id)
    await rm(entry.logFile, { force: true })
    return { id, stopped: true }
}

// --- 后端退出时把还挂着的进程带走，不留孤儿；日志文件一并清掉，行为和 stop 一致 ---
const cleanup = () => {
    for (const entry of running.values()) {
        killTree(entry.child.pid)
        closeSync(entry.fd)
        rm(entry.logFile, { force: true }).catch(() => {})
    }
    running.clear()
}

export { running, spawnDetached, readLog, list, stopProcess, cleanup, killTree }
