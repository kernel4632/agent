/* shell 输出边产生边发送，abort signal 直接停止子进程。 */
export default {
    name: 'shell',
    description: 'Run a shell command and return stdout and stderr.',
    inputSchema: {
        type: 'object',
        properties: {
            command: { type: 'string' },
            cwd: { type: 'string' },
        },
        required: ['command'],
        additionalProperties: false,
    },

    async execute({ command, cwd }, context) {
        const child = Bun.spawn(['sh', '-lc', command], { // 通过 shell 保持常见命令语义。
            cwd, // 在用户指定工作目录执行。
            detached: true, // 让取消时可终止整个进程组。
            signal: context.signal, // 接收 Agent.stop 的取消。
            stdout: 'pipe', // 逐块读取标准输出。
            stderr: 'pipe', // 逐块读取错误输出。
        })
        context.signal.addEventListener('abort', () => {
            child.kill() // 先结束 shell 主进程。
            try { globalThis.process.kill(-child.pid) } catch {} // 再尽力结束其子进程组。
        }, { once: true })

        let stdout = '' // 汇总最终返回给模型的标准输出。
        let stderr = '' // 汇总最终返回给模型的错误输出。
        await Promise.all([
            (async () => {
                for await (const chunk of child.stdout) {
                    const data = new TextDecoder().decode(chunk) // 将字节块转为文本。
                    stdout += data // 保留完整最终输出。
                    await context.receive({ stream: 'stdout', data }) // 同时实时推送页面。
                }
            })(),
            (async () => {
                for await (const chunk of child.stderr) {
                    const data = new TextDecoder().decode(chunk) // 将错误字节块转为文本。
                    stderr += data // 保留完整错误输出。
                    await context.receive({ stream: 'stderr', data }) // 同时实时推送页面。
                }
            })(),
            child.exited,
        ])
        return { output: { stdout, stderr } } // 工具消息保留两条输出通道。
    },
}
