/*
 * 命令工具：在指定目录执行一条命令，把输出和退出码一起交给模型。
 *
 * 输出会两路给出：一路实时转发给前端边跑边看，一路读回来放进工具结果。
 * 必须自己读回来——只返回退出码的话，模型看不到命令说了什么（已实测确认）。
 * 调用示例：模型调用 shell({ command: 'git status', directory: 'D:/projects/app' })。
 */
import { truncate } from './truncate.js' // 长输出只留头尾，避免一次性塞满上下文。

// 命令最多跑十分钟，防止装依赖或死循环把整个任务挂死。
const TIMEOUT_MS = 10 * 60 * 1000

export default {
    name: 'shell',
    description: 'Run a shell command in a directory and return its output and exit code.',
    inputSchema: {
        type: 'object',
        properties: {
            command: { type: 'string' },
            directory: { type: 'string' },
        },
        required: ['command'],
    },

    // --- 执行命令 ---
    async execute({ command, directory }, { abortSignal }) {
        const process = Bun.spawn({
            cmd: ['cmd.exe', '/d', '/s', '/c', command],
            cwd: directory,
            stdout: 'pipe',
            stderr: 'pipe',
        })

        // 用户点停止或等待超时都要结束这条命令，不让它留在后台继续跑。
        let timedOut = false
        const stop = () => {
            process.kill()
        }
        abortSignal?.addEventListener('abort', stop, { once: true })
        const timer = setTimeout(() => {
            timedOut = true
            stop()
        }, TIMEOUT_MS)

        try {
            const [stdout, stderr, exitCode] = await Promise.all([
                process.stdout.text(), // 读回来的输出既进结果，也已经被工具执行器实时转发过。
                process.stderr.text(),
                process.exited,
            ])
            return {
                exitCode,
                stdout: truncate(stdout.trimEnd()),
                stderr: truncate(stderr.trimEnd()),
                timedOut, // 超时被杀时告诉模型原因，它才知道该换一条命令而不是重试。
            }
        } finally {
            clearTimeout(timer)
            abortSignal?.removeEventListener('abort', stop)
        }
    },
}
