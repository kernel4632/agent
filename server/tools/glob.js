/* Bun.Glob 直接扫描目录，固定上限防止结果淹没上下文。 */
export default {
    name: 'glob',
    description: 'Find files matching a glob pattern under a directory.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            pattern: { type: 'string' },
        },
        required: ['path', 'pattern'], additionalProperties: false,
    },
    async execute({ path, pattern }) {
        const files = []

        // 结果达到上限后立即停止扫描，避免占满上下文。
        for await (const file of new Bun.Glob(pattern).scan({ cwd: path, dot: true })) {
            files.push(file)
            if (files.length >= 1000) break
        }
        return { output: files }
    },
}
