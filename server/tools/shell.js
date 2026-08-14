/* 使用系统 shell，stdout/stderr 边产生边发送。 */
export default {
    name: 'shell', description: 'Run a shell command and return stdout, stderr, and exit code.',
    inputSchema: {
        type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' } },
        required: ['command'], additionalProperties: false,
    },
    async execute({ command, cwd }, context) {
        const child = Bun.spawn(['sh', '-lc', command], { cwd, detached: true, signal: context.signal, stdout: 'pipe', stderr: 'pipe' })
        const running = { kill() { child.kill(); try { globalThis.process.kill(-child.pid) } catch {} } }
        context.signal?.addEventListener('abort', running.kill, { once: true })
        context.processes?.add(running)
        const read = async (stream, name) => {
            let text = ''
            for await (const chunk of stream) {
                const data = new TextDecoder().decode(chunk)
                text += data
                await context.receive({ stream: name, data })
            }
            return text
        }
        const [stdout, stderr, code] = await Promise.all([read(child.stdout, 'stdout'), read(child.stderr, 'stderr'), child.exited])
        context.signal?.removeEventListener('abort', running.kill)
        context.processes?.delete(running)
        return { output: { stdout, stderr, code } }
    },
}
