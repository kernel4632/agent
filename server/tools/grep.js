/* 内容搜索交给成熟的 ripgrep，不在内核重写搜索器。 */
import { rgPath } from '@vscode/ripgrep'

export default {
    name: 'grep', description: 'Search file contents with a regular expression using ripgrep.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            pattern: { type: 'string' },
            include: { type: 'string' },
        },
        required: ['path', 'pattern'], additionalProperties: false,
    },
    async execute({ path, pattern, include }, context) {
        // 组装 ripgrep 参数，保留 JSON 输出方便上层继续使用。
        const args = [rgPath, '--json', '--line-number', '--color=never']
        if (include) args.push('--glob', include)
        args.push(pattern, path)

        const process = Bun.spawn(args, { signal: context.signal, stdout: 'pipe', stderr: 'pipe' })
        const [stdout, stderr, code] = await Promise.all([
            new Response(process.stdout).text(),
            new Response(process.stderr).text(),
            process.exited,
        ])
        if (code > 1) throw new Error(stderr.trim())
        return { output: stdout.split('\n').filter(Boolean).map(JSON.parse).filter(event => event.type === 'match') }
    },
}
