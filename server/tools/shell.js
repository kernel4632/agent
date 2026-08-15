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
        const child = Bun.spawn(['sh', '-lc', command], {
            cwd,
            detached: true,
            signal: context.signal,
            stdout: 'pipe',
            stderr: 'pipe',
        })
        context.signal.addEventListener('abort', () => {
            child.kill()
            try { globalThis.process.kill(-child.pid) } catch {}
        }, { once: true })

        let stdout = ''
        let stderr = ''
        await Promise.all([
            (async () => {
                for await (const chunk of child.stdout) {
                    const data = new TextDecoder().decode(chunk)
                    stdout += data
                    await context.receive({ stream: 'stdout', data })
                }
            })(),
            (async () => {
                for await (const chunk of child.stderr) {
                    const data = new TextDecoder().decode(chunk)
                    stderr += data
                    await context.receive({ stream: 'stderr', data })
                }
            })(),
            child.exited,
        ])
        return { output: { stdout, stderr } }
    },
}
