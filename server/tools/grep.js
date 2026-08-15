/* 内容搜索交给成熟的 ripgrep，不在内核重写搜索器。 */
import { rgPath } from '@vscode/ripgrep' // 使用随依赖提供的 ripgrep 可执行文件。

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
        const args = [rgPath, '--json', '--line-number', '--color=never'] // 输出机器可读且无颜色。
        if (include) args.push('--glob', include) // 可选地限制文件名范围。
        args.push(pattern, path) // 最后追加用户模式和搜索根目录。

        const process = Bun.spawn(args, { signal: context.signal, stdout: 'pipe', stderr: 'pipe' }) // stop 会终止搜索。
        const [stdout, stderr, code] = await Promise.all([
            new Response(process.stdout).text(),
            new Response(process.stderr).text(),
            process.exited,
        ])
        if (code > 1) throw new Error(stderr.trim()) // 0 是命中，1 是无命中，其余才是失败。
        return { output: stdout.split('\n').filter(Boolean).map(JSON.parse).filter(event => event.type === 'match') }
    },
}
