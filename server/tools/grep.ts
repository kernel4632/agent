/*
内容搜索工具：调用成熟的 ripgrep，并返回文件、行号和匹配文本。
rg 不存在或表达式无效时直接返回真实错误，不在内核里重写搜索引擎。
*/
import type { AgentTool } from '../types.ts'
import { rgPath } from '@vscode/ripgrep'

const grep: AgentTool = {
    name: 'grep',
    description: 'Search file contents with a regular expression using ripgrep.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            pattern: { type: 'string' },
            include: { type: 'string' },
        },
        required: ['path', 'pattern'],
        additionalProperties: false,
    },
    async execute(input, context) {
        const { path, pattern, include } = input as { path: string; pattern: string; include?: string }
        const args = [rgPath, '--json', '--line-number', '--color=never']
        if (include) args.push('--glob', include)
        args.push(pattern, path)
        const process = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe', signal: context.signal })
        const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
        if (code > 1) throw new Error(stderr.trim())
        return { output: stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(event => event.type === 'match') }
    },
}

export default grep
