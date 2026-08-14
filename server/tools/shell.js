/* 使用系统 shell，stdout/stderr 边产生边发送。 */
export default {
    name: 'shell', description: 'Run a shell command and return stdout, stderr, and exit code.',
    inputSchema: {
        type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' } },
        required: ['command'], additionalProperties: false,
    },
    async execute({ command, cwd }, context) {
        const process = Bun.spawn(['sh', '-lc', command], { cwd, signal: context.signal, stdout: 'pipe', stderr: 'pipe' })
        const read = async (stream, name) => {
            let text = ''
            for await (const chunk of stream) {
                const data = new TextDecoder().decode(chunk)
                text += data
                await context.receive({ stream: name, data })
            }
            return text
        }
        const [stdout, stderr, code] = await Promise.all([read(process.stdout, 'stdout'), read(process.stderr, 'stderr'), process.exited])
        return { output: { stdout, stderr, code } }
    },
}
