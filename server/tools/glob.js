/*
 * 文件匹配工具：按通配模式找文件。
 *
 * 工具只扫描用户指定目录，不修改任何数据。
 * 跳过哪些目录由 utils/skip.js 一处说了算，这里不自己写一份名单。
 * 调用示例：模型调用 glob({ path: 'src', pattern: '**\/*.js' })。
 */
import Skip from '../utils/skip.js' // 依赖目录不算用户要找的文件。

export default {
    name: 'glob',
    description: [
        'Find files whose names match a glob pattern (e.g. **/*.test.js, src/*.ts), searching under a directory.',
        'Use this to locate files by name pattern when you do not know the exact path — before reading, editing or listing them.',
        'Returns matching paths, not contents. Follow up with file_read on the files you care about.',
        'Parameters:',
        '- path (required): directory to search in.',
        '- pattern (required): glob pattern for file names.',
    ].join('\n'),
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
            // 依赖目录动辄几万个文件，模型要的是自己写的代码，不是第三方包。
            if (Skip.search(file)) continue
            files.push(file) // 立即记录命中的路径。
            if (files.length >= 1000) break // 单次工具调用最多返回一千项。
        }
        return files // 直接给模型可继续使用的路径数组。
    },
}
