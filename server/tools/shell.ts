import { execa } from 'execa'
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
        const process = execa('sh', ['-lc', command], { cwd: path, cancelSignal: context.signal, killDescendants: true })
        process.stdout?.on('data', data => void context.receive?.({ stream: 'stdout', data: String(data) }))
        process.stderr?.on('data', data => void context.receive?.({ stream: 'stderr', data: String(data) }))
        const result = await process
        return { output: { stdout: result.stdout, stderr: result.stderr, code: result.exitCode } }
    },
}

export default shell
