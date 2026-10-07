/*
 * 文件内容搜索工具。
 *
 * 工具把搜索交给 ripgrep，不承担会话业务；退出码 1 代表没有匹配。
 * 调用示例：模型调用 grep({ path: 'src', pattern: 'TODO', include: '*.js' })。
 */
import { rgPath } from '@vscode/ripgrep' // 使用随依赖提供的 ripgrep 可执行文件。
import { truncate } from './truncate.js' // 命中太多时只留头尾。

export default {
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
    },
    // --- 搜索文件内容 ---
    async execute({ path, pattern, include }, { abortSignal }) {
        // 第三方依赖目录不是用户要搜的目标，在 ripgrep 层就排除掉，也省掉无谓的扫描。
        const command = [rgPath, '--line-number', '--color', 'never', '--glob', '!**/node_modules/**']
        if (include) command.push('--glob', include)
        command.push(pattern, '.')

        // stdout 和 stderr 由工具执行器实时转发，最终输出在这里一次性读回来交给模型。
        const process = Bun.spawn(command, { cwd: path, stdout: 'pipe', stderr: 'pipe' })
        abortSignal?.addEventListener('abort', () => process.kill(), { once: true })
        const [output, error, exitCode] = await Promise.all([
            process.stdout.text(),
            process.stderr.text(),
            process.exited,
        ])

        // ripgrep 用 1 表示"没有匹配"，这不是程序错误。
        if (exitCode > 1) throw new Error(error.trim() || `ripgrep exited with code ${exitCode}`)
        return truncate(output.trimEnd()) // 命中成千上万行时只把头尾给模型。
    },
}
