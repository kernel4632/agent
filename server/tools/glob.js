/* Bun.Glob 直接扫描目录，limit 防止结果淹没上下文。 */
export default {
    name: 'glob', description: 'Find files matching a glob pattern under a directory.',
    inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, pattern: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10000, default: 1000 } },
        required: ['path', 'pattern'], additionalProperties: false,
    },
    async execute({ path, pattern, limit = 1000 }) {
        const files = []
        for await (const file of new Bun.Glob(pattern).scan({ cwd: path, dot: true })) {
            files.push(file)
            if (files.length >= limit) break
        }
        return { output: files }
    },
}
