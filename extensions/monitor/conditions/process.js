/*
 * 后台进程监控条件：监视 execute_command({ background: true }) 启动的长进程。
 *
 * 结合 la 原生的 utils/process.js，直接读取进程表退出码或等待指定输出行。
 * 调用示例：
 *   const spec = ProcessCondition.normalize({ kind: 'process', id: 'a1f2', when: 'settled' })
 *   const result = await ProcessCondition.check(spec, state, { cwd })
 */

import { list, readLog } from '@agent/utils/process.js'

const ProcessCondition = {
    kind: 'process',                           // 条件标识，与文件名一致
    label: '后台进程',                         // 人类可读标签

    // --- 边界参数整理与校验 ---
    normalize(raw = {}) {
        const id = String(raw.id || '').trim() // 进程短句柄，如 a1f2
        if (!id) throw new Error('process 条件必须提供后台进程 id（即 execute_command 返回的短 ID）')

        const validWhens = ['settled', 'exit_zero', 'exit_nonzero', 'output']
        const rawWhen = String(raw.when || (raw.waitFor ? 'output' : 'settled')).toLowerCase()
        const when = validWhens.includes(rawWhen) ? rawWhen : 'settled'
        const waitFor = raw.waitFor ? String(raw.waitFor).trim() : undefined

        return {
            kind: 'process',
            id,
            when,
            waitFor,
        }
    },

    // --- 一行简短摘要 ---
    describe(spec) {
        if (spec.waitFor) return `后台进程 ${spec.id} 输出匹配 "${spec.waitFor}"`
        const whenText = spec.when === 'exit_zero' ? '成功退出 (0)' : spec.when === 'exit_nonzero' ? '异常非零退出' : '结束 (settled)'
        return `后台进程 ${spec.id} ${whenText}`
    },

    // --- 初始基线 ---
    async start(spec) {
        const found = list().find(p => p.id === spec.id) // 查进程表当前状态
        return {
            seen: Boolean(found),              // 记录此前是否在表内见到过
            initialExitCode: found?.exitCode ?? null, // 初始退出码
        }
    },

    // --- 单次状态检查 ---
    async check(spec, state) {
        const now = Date.now()                 // 当前时间戳
        const nextCheckAt = now + 1000         // 默认 1 秒后再次检查

        const proc = list().find(p => p.id === spec.id) // 查最新的运行表

        // 场景 1：如果配置了 waitFor，主动读日志查是否出现特定行
        if (spec.waitFor) {
            const { output, matched, exited, exitCode } = await readLog(spec.id, 50, { waitFor: spec.waitFor, waitMs: 0 })
            if (matched) {                     // 命中目标文本
                return {
                    fired: true,
                    evidence: `进程 ${spec.id} 输出命中 "${spec.waitFor}"：\n---\n${output.slice(-500)}`,
                    nextCheckAt: now + 86400000,
                }
            }
            if (exited) {                      // 未等到输出而进程提前退出了
                return {
                    fired: true,
                    evidence: `进程 ${spec.id} 已结束退出 (退出码 ${exitCode})，未见 "${spec.waitFor}"。最近输出：\n---\n${output.slice(-500)}`,
                    nextCheckAt: now + 86400000,
                }
            }
            return { fired: false, state: { seen: true }, nextCheckAt }
        }

        // 场景 2：进程表内能找到，判定其是否达到终态
        if (proc) {
            if (proc.exited) {                 // 进程已退出
                let fired = false
                let reason = ''

                if (spec.when === 'settled') {
                    fired = true
                    reason = `进程 ${spec.id} 已结束退出（退出码 ${proc.exitCode ?? 0}）`
                } else if (spec.when === 'exit_zero') {
                    fired = proc.exitCode === 0
                    reason = `进程 ${spec.id} 成功退出（退出码 0）`
                } else if (spec.when === 'exit_nonzero') {
                    fired = proc.exitCode !== 0
                    reason = `进程 ${spec.id} 非零退出（退出码 ${proc.exitCode}）`
                }

                if (fired) {
                    const { output } = await readLog(spec.id, 20).catch(() => ({ output: '' }))
                    return {
                        fired: true,
                        evidence: `${reason}\n---\n${output || '(无控制台日志)'}`,
                        nextCheckAt: now + 86400000,
                    }
                }
            }
            return { fired: false, state: { seen: true }, nextCheckAt }
        }

        // 场景 3：表里找不到了，且之前确实运行过，说明已被清理收尾
        if (state.seen) {
            return {
                fired: true,
                evidence: `进程 ${spec.id} 已不在运行进程表中（已退出并回收）`,
                nextCheckAt: now + 86400000,
            }
        }

        return { fired: false, nextCheckAt }
    },
}

export default ProcessCondition
