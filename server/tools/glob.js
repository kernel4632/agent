/*
 * 文件匹配工具：按通配模式找文件。
 *
 * 工具只扫描用户指定目录，不修改任何数据。
 * 调用示例：模型调用 glob({ path: 'src', pattern: '**\/*.js' })。
 */
export default {
    name: 'glob',
    description: 'Find files matching a glob pattern under a directory.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            pattern: { type: 'string' },
        },
        required: ['path', 'pattern'],
    },
    // --- 查找匹配文件 ---
    async execute({ path, pattern }) {
        const files = [] // 保持扫描顺序的相对路径结果。

        // 结果达到上限后立即停止扫描，避免占满上下文。
        for await (const file of new Bun.Glob(pattern).scan({ cwd: path, dot: true })) {
            files.push(file) // 立即记录命中的路径。
            if (files.length >= 1000) break // 单次工具调用最多返回一千项。
        }
        return files // 直接给模型可继续使用的路径数组。
    },
}
