/*
 * 测试工具：跑一条测试命令，把 pass/fail 整理成结构化结果交回。
 *
 * 模型看原始测试输出要自己扫 pass/fail，全量输出被截断时中间的失败还会漏看。
 * 这里统一解析 bun test / playwright 的输出：多少通过、哪些失败、
 * 每个失败的文件和原因各一行。解析不认识的格式时退回原始输出的头尾。
 * 调用示例：模型调用 test({ command: 'bun test', cwd: 'server' })
 */

import { isAbsolute, resolve } from 'node:path'

// 命令最多等 30 分钟：全量界面测试比其它命令慢得多。
const TIMEOUT_MS = 30 * 60 * 1000

// --- 从 bun test 的输出里抠出统计行和失败明细 ---
// 实测格式（stderr）：统计行 " 1 pass" / " 1 fail"（数字在前，行首空格；ℹ 只在带终端色彩时出现）；
// 失败行 "(fail) 样例 > 失败的一例 [0.12ms]"，没有 [文件] 前缀，文件名在它前面的 "xxx.test.js:" 行。
const parseBun = output => {
    const grab = name => {
        const match = output.match(new RegExp(`(?:^|\\n)\\s*ℹ?\\s*(\\d+)\\s+${name}\\b`))
        return match ? Number(match[1]) : null
    }
    const passed = grab('pass')
    const failed = grab('fail')
    if (passed == null && failed == null) return null

    // 失败明细：从每个 (fail) 往前找最近的 "<file>.test.js:" 行当作来源文件。
    const fileBefore = index => {
        const head = output.slice(0, index)
        const match = head.match(/([^\s/\\]+\.test\.[a-z]+):\s/)
        return match ? match[1] : '（文件名未知）'
    }
    const failures = [...output.matchAll(/\(fail\)\s*(.+?)\s+\[\d+\.?[\d]*m?s?\]/g)].map(match => ({
        file: fileBefore(match.index),
        test: match[1].trim(),
    }))
    return { passed: passed ?? 0, failed: failed ?? 0, failures }
}

// --- playwright 的 line 输出："  2 passed (8.9s)"、"  1 failed"；失败明细是 "1) [file] › test" ---
const parsePlaywright = output => {
    const passed = output.match(/^\s*(\d+)\s+passed/m)
    const failed = output.match(/^\s*(\d+)\s+failed/m)
    if (!passed && !failed) return null
    const failures = [...output.matchAll(/^\s*\d+\)\s*\[(.+?)\]\s*›\s*(.+)$/gm)].map(match => ({
        file: match[1],
        test: match[2].trim(),
    }))
    return { passed: passed ? Number(passed[1]) : 0, failed: failed ? Number(failed[1]) : 0, failures }
}

// --- 两家都对不上时用通用符号数一遍；仍然数不出就交 null，由调用方退回原始输出 ---
const parseGeneric = output => {
    const passed = (output.match(/✔/g) || []).length
    const failed = (output.match(/✖|✗|FAIL/g) || []).length
    return passed || failed ? { passed, failed, failures: [] } : null
}

const truncate = (text, limit = 6000) => {
    if (text.length <= limit) return text
    const half = Math.floor(limit / 2)
    return `${text.slice(0, half)}\n\n...（中间省略 ${text.length - half * 2} 个字符）...\n\n${text.slice(-half)}`
}

const tests = {
    name: 'test',
    kind: 'command',
    ui: {
        view: 'command',
        icon: 'check',
        title: '跑测试',
        summary: '{command}',
        actions: [{ id: 'copy-command', label: '复制命令', icon: 'copy', type: 'copy', value: 'command' }],
    },
    description: [
        'Run a test command and return structured results: passed/failed counts plus each failure as { file, test }.',
        'Parses bun test and Playwright output natively; unknown formats fall back to raw output (head and tail).',
        'Suitable for "bun test", "bun run test:ui", "playwright test -g ..." — anything that prints pass/fail.',
        'The full raw output is included, truncated like execute_command; the structured summary adds the counts you can trust.',
        'Parameters: - command (required): the test command. - cwd (optional): directory relative to the session current directory.',
        '- timeout (optional): kill after this many milliseconds; default 1800000 (30 minutes).',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            command: { type: 'string' },
            cwd: { type: 'string' },
            timeout: { type: 'integer', minimum: 1000, maximum: 3600000 },
        },
        required: ['command'],
    },

    async execute({ command, cwd, timeout }, options = {}) {
        if (typeof command !== 'string' || !command.trim()) throw new Error('command is required')
        const base = options.cwd || process.cwd()
        const workdir = cwd ? (isAbsolute(cwd) ? cwd : resolve(base, cwd)) : base

        const child = Bun.spawn({
            cmd: process.platform === 'win32'
                ? ['cmd.exe', '/d', '/s', '/c', command]
                : ['sh', '-c', command],
            cwd: workdir,
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const kill = () => child.kill()
        options.abortSignal?.addEventListener('abort', kill, { once: true })
        const requested = Number(timeout)
        const limit = Number.isFinite(requested) && requested >= 1000 ? Math.min(requested, 3600000) : TIMEOUT_MS
        const timer = setTimeout(kill, limit)

        try {
            const [stdout, stderr, exitCode] = await Promise.all([
                child.stdout.text(),
                child.stderr.text(),
                child.exited,
            ])
            const output = `${stdout}\n${stderr}`
            // bun/playwright/generic 依次试；解析出的失败列表是模型最需要的东西。
            const summary = parseBun(output) || parsePlaywright(output) || parseGeneric(output)

            return {
                exitCode,
                ...(summary ? { summary } : {}),
                output: truncate(output.trimEnd()),
            }
        } finally {
            clearTimeout(timer)
            options.abortSignal?.removeEventListener('abort', kill)
        }
    },
}

export default tests
