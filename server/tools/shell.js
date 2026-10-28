/*
 * 执行命令工具：在会话当前目录里跑一条命令，把输出和退出码交给模型。
 *
 * 输出会两路给出：一路实时转发给前端边跑边看，一路读回来放进工具结果。
 * 长输出只保留头尾，截断规则由这个工具自己决定。
 *
 * 调用示例：模型调用 execute_command({ command: 'bun test', cwd: 'src' })
 */

import { isAbsolute, resolve } from 'node:path'

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
        'Use this for anything not covered by a dedicated tool: installing dependencies, running builds and tests, starting dev servers.',
        'The command runs once and waits for completion; interactive prompts that need typing will hang.',
        'Parameters: - command (required): the command line to run. - cwd (optional): directory relative to the session current directory.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            command: { type: 'string' },
            cwd: { type: 'string' },
        },
        required: ['command'],
    },

    // 第二参必须可省：agent-core 的契约是 execute(input, options?)。
    async execute({ command, cwd }, options = {}) {
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
        let timedOut = false
        const stop = () => child.kill()
        options.abortSignal?.addEventListener('abort', stop, { once: true })
        const timer = setTimeout(() => {
            timedOut = true
            stop()
        }, TIMEOUT_MS)

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
