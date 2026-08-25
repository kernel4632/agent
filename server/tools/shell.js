/* shell 只负责启动命令，输出捕获和强制终止由 Tool 执行器自动完成。 */
export default {
    name: 'shell',
    description: 'Run a shell command and return stdout and stderr.',
    inputSchema: {
        type: 'object',
        properties: {
            command: { type: 'string' },
            directory: { type: 'string' },
        },
        required: ['command'],

    },

    async execute({ command, directory }) {
        // Tool Worker 会自动接管 stdout/stderr，并通过 SSE 实时发送。
        const process = Bun.spawn({
            cmd: ['cmd.exe', '/d', '/s', '/c', command],
            cwd: directory,
            stdout: 'pipe',
            stderr: 'pipe',
        })
        return { exitCode: await process.exited }
    },
}
