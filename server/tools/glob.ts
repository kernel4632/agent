/*
文件匹配工具：使用 Bun.Glob 扫描任意目录，不额外维护文件索引。
结果上限由调用参数控制，避免超大目录一次淹没模型上下文。
*/
import type { AgentTool } from '../types.ts'

const glob: AgentTool = {
    name: 'glob',
    description: 'Find files matching a glob pattern under any directory.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            pattern: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 10000, default: 1000 },
        },
        required: ['path', 'pattern'],
        additionalProperties: false,
    },
    async execute(input) {
        const { path, pattern, limit = 1000 } = input as { path: string; pattern: string; limit?: number }
        const files: string[] = []
        for await (const file of new Bun.Glob(pattern).scan({ cwd: path, dot: true })) {
            files.push(file)
            if (files.length >= limit) break
        }
        return { output: files }
    },
}

export default glob
