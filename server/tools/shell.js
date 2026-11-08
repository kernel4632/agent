/*
 * 执行命令工具：在会话当前目录里跑一条命令，把输出和退出码交给模型。
 *
 * 命令的输出写进数据目录的日志文件，前台和后台看到的是同一份（见 utils/process.js）。
 * 长输出只保留头尾，截断规则由这个工具自己决定。
 *
 * 到点没跑完不“杀”而是“交棒”：命令继续跑，返回进程 id，后续用 background 的 log 接着看。
 * 杀掉等于整轮工作白跑（装依赖、跑测试都得重来），而模型本来就猜不准要跑多久。
 *
 * 调用示例：模型调用 execute_command({ command: 'bun test', cwd: 'server' })
 */

import { isAbsolute, resolve } from 'node:path'
import { spawnTracked, releaseTracked, readTextFile, killTree } from '../utils/process.js'

// 前台最多等十分钟，之后交棒给后台，避免把整个任务挂死。
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
        'Set background: true to start it in the background instead: returns immediately with a process id; read output later with background (action: log, optionally with waitFor/waitMs). Use this for long jobs that would otherwise block: full test suites, dev servers, installs.',
        'You do not have to guess how long a command takes. If it is still running when timeout elapses it is NOT killed: you get back the process id, the partial output so far, and timedOut: true. Continue with background({ action: "log", id }).',
        'Parameters: - command (required): the command line to run. - cwd (optional): directory relative to the session current directory.',
        '- timeout (optional): how long to wait before handing the still-running command over to the background, in milliseconds; default 600000 (10 minutes).',
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
        options.abortSignal?.throwIfAborted()
        if (typeof command !== 'string' || !command.trim()) throw new Error('command is required')

        const base = options.cwd || process.cwd()
        const workdir = cwd ? (isAbsolute(cwd) ? cwd : resolve(base, cwd)) : base

        // 前台和后台走同一个启动函数：输出都进日志文件，交棒时才不用重跑命令。
        const started = await spawnTracked({ command, workdir })

        // background: true 时不等结果，交一张进程卡就走。
        if (background === true) {
            return { id: started.id, pid: started.pid, logFile: started.logFile, command, cwd: workdir }
        }

        // 按次传的 timeout 优先于默认上限；填错时用默认值，不因此拒绝执行。
        const requested = Number(timeout)
        const limit = Number.isFinite(requested) && requested >= 1000 ? Math.min(requested, 3600000) : TIMEOUT_MS

        // 用户取消才是真杀；时间到只是交棒。
        const stop = () => killTree(started.pid)
        options.abortSignal?.addEventListener('abort', stop, { once: true })

        let timedOut = false
        const timer = setTimeout(() => { timedOut = true }, limit)
        const ticker = new Promise(resolve => {
            const tick = () => (timedOut ? resolve('timeout') : setTimeout(tick, 25))
            tick()
        })

        try {
            const finish = started.child.exited.then(code => `exit:${code}`)
            const outcome = await Promise.race([ticker, finish])

            if (outcome !== 'timeout') {
                const output = readTextFile(started.logFile)
                // 前台跑完就销号：结果已经读进上下文，日志不必再占磁盘。
                await releaseTracked(started.id)
                return {
                    exitCode: started.child.exitCode,
                    stdout: truncate(output.trimEnd()),
                    stderr: '',
                    timedOut: false,
                }
            }

            // 到点还没结束：进程原样留着，只是交给后台登记继续用同一个日志文件。
            return {
                timedOut: true,
                id: started.id,
                pid: started.pid,
                logFile: started.logFile,
                running: true,
                output: truncate(readTextFile(started.logFile).trimEnd()),
                hint: `Still running after ${Math.round(limit / 1000)}s, so it was left running instead of being killed. Read more with background({ action: "log", id: "${started.id}", waitFor: "...", waitMs: 10000 }) or stop it with background({ action: "stop", id: "${started.id}" }).`,
            }
        } finally {
            clearTimeout(timer)
            options.abortSignal?.removeEventListener('abort', stop)
        }
    },

    // 交棒时返回的是对象；模型要读到已产生的输出和下一步怎么做。
    toModelOutput({ output }) {
        if (typeof output === 'string') return { type: 'text', value: output }
        if (!output?.timedOut) {
            return { type: 'text', value: `exitCode: ${output?.exitCode}\n\n${output?.stdout || ''}` }
        }
        return { type: 'text', value: `processId: ${output.id}\n\n${output.output || '(还没有输出)'}\n\n${output.hint}` }
    },
}

export default shell
