/*
 * 文件内容搜索工具。
 *
 * 工具把搜索交给 ripgrep，不承担会话业务；退出码 1 代表没有匹配。
 * 数据流：Agent 触发工具 → 启动 ripgrep → 收集输出 → 返回文本反馈。
 */
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
    // --- 搜索文件内容 ---
    async execute({ path, pattern, include }) {
        const command = [rgPath, '--line-number', '--color', 'never']
        if (include) command.push('--glob', include)
        command.push(pattern, '.')

        // Worker 会把输出分成两路：一路实时发送，另一路在这里组成最终结果。
        const process = Bun.spawn(command, { cwd: path, stdout: 'pipe', stderr: 'pipe' })
        const [output, error, exitCode] = await Promise.all([
            process.stdout.text(),
            process.stderr.text(),
            process.exited,
        ])

        // ripgrep 用 1 表示“没有匹配”，这不是程序错误。
        if (exitCode > 1) throw new Error(error.trim() || `ripgrep exited with code ${exitCode}`)
        return { output: output.trimEnd() }
    },
}
