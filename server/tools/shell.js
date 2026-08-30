/*
 * Windows 命令工具。
 *
 * 工具只启动命令；输出捕获和强制终止由 Agent Core 的工具执行器负责。
 * 数据流：Agent 触发工具 → cmd.exe 执行 → 返回退出码 → 执行器反馈输出。
 */
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

    // --- 执行 Windows 命令 ---
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
