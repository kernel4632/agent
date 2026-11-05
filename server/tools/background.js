/*
 * 后台进程工具：把一条命令放进后台跑，随时看日志、随时停。
 *
 * 长活不再阻塞对话：起 dev server、跑全量测试、挂一个监听进程，都用这个。
 * stdout/stderr 直接接到数据目录 processes/ 下的日志文件（实测 cmd.exe 包装的管道
 * 要等进程退出才 flush，子进程直接写文件是唯一实时的路子；execute_command 的
 * stdout.text() 能读到是因为它等命令结束）。
 * 进程表只在内存里，重启后端即清空；磁盘上残留的日志还能看，但进程已不属于这个后端。
 * 只有三步：start → log → stop；每个进程一个短 id，模型引用起来不费 token。
 *
 * 调用示例：
 *   模型调用 background({ action: 'start', command: 'bun run dev', cwd: 'frontend' })
 *   模型调用 background({ action: 'log', id: 'a1f2', tail: 200 })
 *   模型调用 background({ action: 'stop', id: 'a1f2' })
 */

import { mkdir, rm } from 'node:fs/promises'
import { openSync, closeSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'
import Path from '../utils/path.js'

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
const start = async ({ command, cwd }, options = {}) => {
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
const log = async ({ id, tail = 200 }) => {
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
const list = () => [...running.values()].map(entry => ({
    pid: entry.child.pid,
    command: entry.command,
    cwd: entry.cwd,
    startedAt: entry.startedAt,
    exited: entry.child.exitCode != null,
    exitCode: entry.child.exitCode,
}))

// --- 停止一个进程：整棵杀掉、关掉文件句柄、清掉日志文件 ---
const stop = async ({ id }) => {
    const entry = running.get(id)
    if (!entry) throw new Error(`Process not found: ${id}`)
    killTree(entry.child.pid)
    closeSync(entry.fd)
    running.delete(id)
    await rm(entry.logFile, { force: true })
    return { id, stopped: true }
}

const background = {
    name: 'background',
    kind: 'command',
    ui: {
        view: 'command',
        icon: 'code',
        title: '后台进程',
        summary: '{command}',
        actions: [{ id: 'copy-command', label: '复制命令', icon: 'copy', type: 'copy', value: 'command' }],
    },
    description: [
        'Run a command in the background and get a process handle, so long jobs never block the conversation.',
        'Three actions: start (run command, return id), log (read latest output, tail lines), stop (kill it).',
        'Output streams live to a log file under the agent data directory; the process table resets when the backend restarts.',
        'Use for dev servers, full test suites, watchers, or anything that keeps running. Use execute_command when the command should finish.',
        'Note: on Windows the command runs under cmd.exe; inline-code commands (e.g. bun -e "...") may produce no captured output — write a script file first for reliable logs.',
        'Parameters: - action (required): start | log | stop | list. - command (start): the command line to run.',
        '- cwd (start): directory relative to the session current directory. - id (log/stop): the handle from start.',
        '- tail (log): how many trailing lines to show, default 200, max 2000.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['start', 'log', 'stop', 'list'] },
            command: { type: 'string' },
            cwd: { type: 'string' },
            id: { type: 'string' },
            tail: { type: 'integer', minimum: 1, maximum: 2000 },
        },
        required: ['action'],
    },

    async execute(input, options = {}) {
        switch (input.action) {
            case 'start': return start(input, options)
            case 'log': return log(input)
            case 'stop': return stop(input)
            case 'list': return { processes: list() }
            default: throw new Error('action must be start | log | stop | list')
        }
    },
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

export { running, cleanup }
export default background
