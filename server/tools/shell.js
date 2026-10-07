/*
 * Windows 命令工具。
 *
 * 工具只启动命令；输出转发和强制终止由 Agent Core 的工具执行器负责。
 * 调用示例：模型调用 shell({ command: 'dir', directory: 'D:/projects' })。
 */
export default {
    name: 'shell',
    description: 'Run a shell command and return its exit code. stdout and stderr are streamed back.',
    inputSchema: {
        type: 'object',
        properties: {
            command: { type: 'string' },
            directory: { type: 'string' },
        },
        required: ['command'],
    },

    // --- 执行 Windows 命令 ---
    async execute({ command, directory }, { abortSignal }) {
        // 工具在独立进程里运行，stdout 和 stderr 会自动转发给上层实时展示。
        const process = Bun.spawn({
            cmd: ['cmd.exe', '/d', '/s', '/c', command],
            cwd: directory,
            stdout: 'pipe',
            stderr: 'pipe',
        })
        // 上层取消（用户点了停止）时立刻结束这条命令，不留在后台继续跑。
        abortSignal?.addEventListener('abort', () => process.kill(), { once: true })
        return { exitCode: await process.exited }
    },
}
