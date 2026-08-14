/*
命令工具：在指定目录启动系统 shell，完整收集 stdout、stderr 与退出码。
AbortSignal 会终止直接进程；Agent.stop 也会通过 runtime 追踪它并杀掉整棵进程树。
*/
import kill from 'tree-kill'
import Store from '../store.ts'
import type { AgentTool } from '../types.ts'

const shell: AgentTool = {
    name: 'shell',
    description: 'Run a shell command in any directory and return stdout, stderr, and exit code.',
    inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' }, path: { type: 'string' } },
        required: ['command'],
        additionalProperties: false,
    },
    async execute(input, context) {
        const { command, path } = input as { command: string; path?: string }
        const process = Bun.spawn(['sh', '-lc', command], { cwd: path, stdout: 'pipe', stderr: 'pipe' })
        const runtime = Store.runtimes[context.sessionID]!
        const abort = () => kill(process.pid, 'SIGTERM', () => undefined)
        runtime.tools.set(context.messageID, { abort })
        context.signal.addEventListener('abort', abort, { once: true })
        try {
            const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
            context.signal.throwIfAborted()
            return { output: { stdout, stderr, code } }
        } finally {
            context.signal.removeEventListener('abort', abort)
            runtime.tools.delete(context.messageID)
        }
    },
}

export default shell
