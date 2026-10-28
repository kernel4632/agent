/*
 * 文件内容搜索工具。
 *
 * 名字和参数对齐 Roo Code：search_files({ path, regex, file_pattern })。
 * 工具把搜索交给 ripgrep，不承担会话业务；退出码 1 代表没有匹配。
 * 跳过哪些目录由 utils/skip.js 一处说了算，这里不自己写一份名单。
 * 调用示例：模型调用 search_files({ path: '.', regex: 'TODO' })。
 */
import { rgPath } from '@vscode/ripgrep' // 使用随依赖提供的 ripgrep 可执行文件。
import Skip from '../utils/skip.js' // 依赖目录不算用户要找的代码。
import { truncate } from '../utils/truncate.js' // 命中太多时只留头尾。

// --- 拼出 ripgrep 的排除参数 ---
const excludeArgs = () => Skip.dependencies.flatMap(name => ['--glob', `!**/${name}/**`])

export default {
    name: 'search_files',
    kind: 'read',
    files: input => [input.path],
    ui: {
        view: 'search',
        icon: 'search',
        title: '搜索文件',
        summary: '{regex}',
        actions: [{ id: 'copy-regex', label: '复制正则', icon: 'copy', type: 'copy', value: 'regex' }],
    },
    description: [
        'Search file contents for a regular expression and return the matching lines with file and line number.',
        'Use this to find where something is defined, used or mentioned across a codebase — faster and cheaper than reading files one by one.',
        'Then use read_file on the hits you care about to see full context.',
        'Parameters:',
        '- path (required): file or directory to search in.',
        '- regex (required): regular expression to look for.',
        '- file_pattern (optional): glob filter for which files to search, e.g. *.js.',
        '- context (optional): number of lines to show before and after each match, 0-20. Use 2-3 when the surrounding code matters.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            regex: { type: 'string' },
            file_pattern: { type: 'string' },
            context: { type: 'integer', minimum: 0, maximum: 20 },
        },
        required: ['path', 'regex'],
    },
    // --- 搜索文件内容 ---
    // 第二参必须可省：agent-core 的契约是 execute(input, options?)，
    // 文件工具跑在子进程里时只收到 input；写成必解构会在真实执行时崩。
    async execute({ path, regex, file_pattern, pattern, include, context }, { abortSignal } = {}) {
        const needle = regex ?? pattern // 旧调用仍可传 pattern。
        const filter = file_pattern ?? include // 旧调用仍可传 include。
        if (!needle) throw new Error('regex is required')

        // 第三方依赖不是用户要搜的目标，在 ripgrep 层就排除掉，也省掉无谓的扫描。
        const command = [rgPath, '--line-number', '--color', 'never', ...excludeArgs()]
        if (filter) command.push('--glob', filter)
        // 只看命中行常常没法判断上下文；context 让调用方一次拿到前后几行。
        const around = Math.min(20, Math.max(0, Math.floor(Number(context) || 0)))
        if (around) command.push('--context', String(around))
        command.push(needle, '.')

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
