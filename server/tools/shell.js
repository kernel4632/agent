/*
 * 执行命令工具：在会话当前目录里跑一条命令，把输出和退出码交给模型。
 *
 * 输出会两路给出：一路实时转发给前端边跑边看，一路读回来放进工具结果。
 * 长输出只保留头尾，截断规则由这个工具自己决定。
 *
 * 调用示例：模型调用 execute_command({ command: 'bun test', cwd: 'src' })
 */

import { execSync } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'
import { spawnDetached } from '../utils/process.js'

// 命令最多跑十分钟，防止装依赖或死循环把整个任务挂死。
const TIMEOUT_MS = 10 * 60 * 1000

// --- 长输出只留头尾 ---
const truncate = (text, limit = 6000) => {
    if (text.length <= limit) return text
    const half = Math.floor(limit / 2)
    return `${text.slice(0, half)}\n\n...（中间省略 ${text.length - half * 2} 个字符）...\n\n${text.slice(-half)}`
}

const shell = {
    name: 'execute_command',
    kind: 'command',
    ui: {
        view: 'command',
        icon: 'code',
        title: '执行命令',
        summary: '{command}',
        actions: [{ id: 'copy-command', label: '复制命令', icon: 'copy', type: 'copy', value: 'command' }],
    },
    description: [
        'Execute a CLI command on the system and return its output (stdout and stderr) and exit code. Long output is truncated, keeping the head and tail.',
        'Use this for anything not covered by a dedicated tool: installing programs, converting files, fetching data, checking your system.',
        'The command runs once and waits for completion; interactive prompts that need typing will hang.',
        'Set background: true to run it in the background instead: returns immediately with a process id and log file; read output later with the background tool (action: log). Use this for long jobs that would otherwise block: full test suites, dev servers, installs.',
        'Parameters: - command (required): the command line to run. - cwd (optional): directory relative to the session current directory.',
        '- timeout (optional): kill the command after this many milliseconds; default 600000 (10 minutes). A killed run returns exitCode with timedOut: true.',
        '- background (optional): true to start it in the background and return a handle instead of waiting.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            command: { type: 'string' },
            cwd: { type: 'string' },
            timeout: { type: 'integer', minimum: 1000, maximum: 3600000 },
            background: { type: 'boolean', description: 'Run in the background: return a handle immediately instead of waiting for completion.' },
        },
        required: ['command'],
    },

    // 第二参必须可省：agent-core 的契约是 execute(input, options?)。
    async execute({ command, cwd, timeout, background }, options = {}) {
        // background: true 时不等结果，交一张进程卡就走：日志稍后用 background 工具的 log 读。
        if (background === true) return spawnDetached({ command, cwd }, options)

        const base = options.cwd || process.cwd()
        const workdir = cwd ? (isAbsolute(cwd) ? cwd : resolve(base, cwd)) : base
        const platform = process.platform
        const child = Bun.spawn({
            cmd: platform === 'win32'
                ? ['cmd.exe', '/d', '/s', '/c', command]
                : ['sh', '-c', command],
            cwd: workdir,
            stdout: 'pipe',
            stderr: 'pipe',
        })

        // 用户点停止或等待超时都要结束这条命令，不让它留在后台继续跑。
        // Windows 上 cmd /c 会留孙进程（ping、npm run 里的子命令）握着 stdout 管道不关，
        // child.kill() 只杀 cmd 不够；用 taskkill 按进程树整棵杀掉，管道立刻关闭。
        let timedOut = false
        const stop = () => {
            if (process.platform === 'win32') execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' })
            else child.kill()
        }
        options.abortSignal?.addEventListener('abort', stop, { once: true })
        // 按次传的 timeout 优先于默认上限；填错时用默认值，不因此拒绝执行。
        const requested = Number(timeout)
        const limit = Number.isFinite(requested) && requested >= 1000 ? Math.min(requested, 3600000) : TIMEOUT_MS
        const timer = setTimeout(() => {
            timedOut = true
            stop()
        }, limit)

        try {
            const [stdout, stderr, exitCode] = await Promise.all([
                child.stdout.text(),
                child.stderr.text(),
                child.exited,
            ])
            return {
                exitCode,
                stdout: truncate(stdout.trimEnd()),
                stderr: truncate(stderr.trimEnd()),
                timedOut,
            }
        } finally {
            clearTimeout(timer)
            options.abortSignal?.removeEventListener('abort', stop)
        }
    },
}

export default shell
