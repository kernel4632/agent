/*
 * 周期命令探测条件：周期执行一条外部探测命令，按退出码或输出触发。
 *
 * 调用示例：
 *   const spec = CommandCondition.normalize({ kind: 'command', command: 'curl -fsS http://127.0.0.1:3000' })
 *   const result = await CommandCondition.check(spec, state, { cwd })
 */

import { isAbsolute, resolve } from 'node:path'

const CommandCondition = {
    kind: 'command',                           // 条件标识
    label: '探测命令',                         // 人类可读标签

    normalize(raw = {}, { cwd = process.cwd() } = {}) {
        const cmd = String(raw.command || '').trim()
        if (!cmd) throw new Error('command 条件必须提供非空的 command 命令文本')

        const targetCwd = raw.cwd
            ? (isAbsolute(raw.cwd) ? raw.cwd : resolve(cwd, raw.cwd))
            : cwd

        const interval = Math.max(1, Math.min(3600, Number(raw.intervalSeconds || 5)))
        const timeout = Math.max(1, Math.min(60, Number(raw.timeoutSeconds || 10)))
        const validWhens = ['exit_zero', 'exit_nonzero', 'output_match']
        const fireWhen = validWhens.includes(raw.fireWhen) ? raw.fireWhen : 'exit_zero'

        return {
            kind: 'command',
            command: cmd,
            cwd: targetCwd,
            intervalSeconds: interval,
            timeoutSeconds: timeout,
            fireWhen,
            pattern: raw.pattern ? String(raw.pattern).trim() : undefined,
        }
    },

    describe(spec) {
        const display = spec.command.length > 40 ? spec.command.slice(0, 40) + '...' : spec.command
        return `命令 \`${display}\` (${spec.fireWhen}, 每 ${spec.intervalSeconds}s)`
    },

    async start() {
        return {}
    },

    async check(spec) {
        const now = Date.now()
        const nextCheckAt = now + spec.intervalSeconds * 1000

        try {
            const isWindows = process.platform === 'win32'
            const shellCmd = isWindows
                ? ['cmd.exe', '/d', '/s', '/c', spec.command]
                : ['sh', '-c', spec.command]

            const proc = Bun.spawn({
                cmd: shellCmd,
                cwd: spec.cwd,
                stdout: 'pipe',
                stderr: 'pipe',
            })

            // 等待退出或超时
            let timedOut = false
            const timeoutTimer = setTimeout(() => {
                timedOut = true
                try { proc.kill() } catch {}
            }, spec.timeoutSeconds * 1000)

            const [stdoutBuf, stderrBuf] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
            ])
            const exitCode = await proc.exited
            clearTimeout(timeoutTimer)

            if (timedOut) {
                return { fired: false, error: '命令执行超时', nextCheckAt }
            }

            const output = (stdoutBuf + '\n' + stderrBuf).trim()
            let fired = false
            let reason = ''

            if (spec.fireWhen === 'exit_zero') {
                fired = exitCode === 0
                reason = `命令退出码为 0 (成功)`
            } else if (spec.fireWhen === 'exit_nonzero') {
                fired = exitCode !== 0
                reason = `命令退出码为 ${exitCode} (非零退出)`
            } else if (spec.fireWhen === 'output_match' && spec.pattern) {
                fired = output.includes(spec.pattern)
                reason = `命令输出匹配到 "${spec.pattern}"`
            }

            if (fired) {
                const tailLines = output.split('\n').slice(-10).join('\n')
                return {
                    fired: true,
                    evidence: `${reason}\n---\n${tailLines || '(无输出)'}`,
                    nextCheckAt: now + 86400000,
                }
            }

            return { fired: false, nextCheckAt }
        } catch (error) {
            return { fired: false, error: error.message, nextCheckAt }
        }
    },
}

export default CommandCondition
