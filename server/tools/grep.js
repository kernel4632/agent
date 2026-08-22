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
        required: ['path', 'pattern'],
    },
    async execute({ path, pattern, include }) {
    },
}
