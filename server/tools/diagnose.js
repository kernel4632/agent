/*
 * 写后诊断：改完文件等一会儿，跑一次配置里的诊断命令，把输出附在工具结果后面。
 *
 * 这是 roo code 的 write delay 的简化版：它等 VS Code 的 Problems 面板刷新，
 * 我们直接跑用户指定的命令（类型检查、测试、lint 都行），把错误交给模型。
 * 不配置 diagnostics.command 时完全不做任何事，不影响写入速度。
 *
 * 配置写在数据目录的 config.json 里：
 *   "diagnostics": { "command": "bun run typecheck", "delay": 500, "timeout": 30000 }
 * 调用示例：
 *   const extra = await Diagnose.afterWrite()
 *   return `Wrote ${path}${extra}`
 */

import Path from '../utils/path.js' // 数据目录只有这一处规则，诊断也照它找配置。

// 诊断输出也进模型上下文，不能让它无限长。
const MAX_OUTPUT = 8000

// --- 读数据目录的配置，读不到就当没配 ---
const readConfig = async () => {
    try {
        return await Bun.file(Path.config()).json()
    } catch {
        return {}
    }
}

// --- 跑一次诊断命令 ---
const run = async ({ command, cwd = process.cwd(), timeout = 30000 }) => {
    const limit = Math.min(Math.max(Number(timeout) || 30000, 1000), 120000)
    const child = Bun.spawn({
        // 和 execute_command 一样：Windows 走 cmd，其它平台走 sh。
        cmd: process.platform === 'win32' ? ['cmd.exe', '/d', '/s', '/c', command] : ['sh', '-c', command],
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
    })

    let timedOut = false
    const timer = setTimeout(() => {
        timedOut = true
        child.kill()
    }, limit)

    try {
        const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited])
        const output = `${stdout}${stderr}`.trim()
        return {
            exitCode,
            timedOut,
            output: output.length > MAX_OUTPUT ? `${output.slice(0, MAX_OUTPUT)}\n（诊断输出过长，已截断）` : output,
        }
    } finally {
        clearTimeout(timer)
    }
}

/**
 * 一次写入之后要附在工具结果后面的诊断文字。
 * @returns {Promise<string>} 没有诊断、没有输出或执行失败时返回空字符串；不抛错。
 */
const afterWrite = async () => {
    const config = await readConfig()
    const settings = config.diagnostics
    if (!settings || typeof settings.command !== 'string' || !settings.command.trim()) return ''

    try {
        // 等一会儿再跑：有些语言的诊断服务要一点时间才看到刚才的改动。
        const delay = Math.min(Math.max(Number(settings.delay) || 0, 0), 10000)
        if (delay) await Bun.sleep(delay)

        const result = await run({ command: settings.command.trim(), timeout: settings.timeout })
        if (!result.output && !result.timedOut && result.exitCode === 0) return ''

        const status = result.timedOut ? 'timeout' : `exit ${result.exitCode}`
        return `\n\n[diagnostics ${status}]\n${result.output || '（没有输出）'}`
    } catch (error) {
        // 诊断只是顺手的好事，不能因为它把已经成功的写入变成失败。
        return `\n\n[diagnostics failed]\n${error.message}`
    }
}

export default { afterWrite, run }
