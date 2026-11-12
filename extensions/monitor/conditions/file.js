/*
 * 文件监控条件：监视指定路径的创建、删除、修改或内容匹配。
 *
 * 相对路径自动按当前会话 cwd 计算；大文件做 1 MiB 保护。
 * 调用示例：
 *   const spec = FileCondition.normalize({ kind: 'file', path: 'dist/app.js', on: 'change' }, { cwd })
 *   const result = await FileCondition.check(spec, state, { cwd })
 */

import { stat, readFile } from 'node:fs/promises'
import { isAbsolute, resolve, basename } from 'node:path'

const MAX_READ_BYTES = 1024 * 1024             // 内容匹配上限 1 MiB

const FileCondition = {
    kind: 'file',                              // 条件标识
    label: '文件状态',                         // 人类可读标签

    // --- 参数整理与校验 ---
    normalize(raw = {}, { cwd = process.cwd() } = {}) {
        const rawPath = String(raw.path || '').trim()
        if (!rawPath) throw new Error('file 条件必须提供非空的 path 参数')

        const targetPath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath)
        const validActions = ['change', 'create', 'delete', 'match']
        const on = String(raw.on || 'change').toLowerCase()
        if (!validActions.includes(on)) {
            throw new Error(`file 条件的 on 参数必须是 ${validActions.join('/')} 之一`)
        }

        const pattern = raw.pattern ? String(raw.pattern).trim() : undefined
        if (on === 'match' && !pattern) {
            throw new Error('当 on 为 match 时，必须提供非空的 pattern 匹配文本')
        }

        return {
            kind: 'file',
            path: targetPath,
            on,
            pattern,
            patternMode: raw.patternMode === 'regex' ? 'regex' : 'literal',
        }
    },

    // --- 一行简短摘要 ---
    describe(spec) {
        const name = basename(spec.path)
        if (spec.on === 'create') return `等待文件 ${name} 创建`
        if (spec.on === 'delete') return `等待文件 ${name} 被删除`
        if (spec.on === 'match')  return `文件 ${name} 内容包含 "${spec.pattern}"`
        return `文件 ${name} 发生变更`
    },

    // --- 捕获初始基线 ---
    async start(spec) {
        try {
            const s = await stat(spec.path)
            return { exists: true, mtimeMs: s.mtimeMs, size: s.size }
        } catch {
            return { exists: false, mtimeMs: 0, size: 0 }
        }
    },

    // --- 检查状态 ---
    async check(spec, state) {
        const now = Date.now()
        const nextCheckAt = now + 1000         // 文件轮询默认 1 秒一次

        let currentStat = null
        try {
            const s = await stat(spec.path)
            currentStat = { mtimeMs: s.mtimeMs, size: s.size }
        } catch {}

        // 1. 创建 (create)
        if (spec.on === 'create') {
            if (currentStat && !state.exists) {
                return {
                    fired: true,
                    evidence: `文件已创建：${spec.path}（大小 ${currentStat.size} 字节）`,
                    state: { exists: true, ...currentStat },
                    nextCheckAt: now + 86400000,
                }
            }
            return { fired: false, nextCheckAt }
        }

        // 2. 删除 (delete)
        if (spec.on === 'delete') {
            if (!currentStat && state.exists) {
                return {
                    fired: true,
                    evidence: `文件已删除：${spec.path}`,
                    state: { exists: false, mtimeMs: 0, size: 0 },
                    nextCheckAt: now + 86400000,
                }
            }
            return { fired: false, nextCheckAt }
        }

        if (!currentStat) return { fired: false, nextCheckAt } // 文件不可读

        // 3. 变更 (change)
        if (spec.on === 'change') {
            const changed = currentStat.mtimeMs !== state.mtimeMs || currentStat.size !== state.size
            if (changed) {
                return {
                    fired: true,
                    evidence: `文件已更新：大小 ${state.size} -> ${currentStat.size} 字节，时间 ${new Date(currentStat.mtimeMs).toISOString()}`,
                    state: { exists: true, ...currentStat },
                    nextCheckAt: now + 86400000,
                }
            }
            return { fired: false, nextCheckAt }
        }

        // 4. 匹配 (match)
        if (spec.on === 'match') {
            if (currentStat.size > MAX_READ_BYTES) {
                return {
                    fired: false,
                    error: `文件 ${spec.path} 大小超过 1 MiB 限制`,
                    nextCheckAt: nextCheckAt + 5000,
                }
            }

            const text = await readFile(spec.path, 'utf-8')
            const lines = text.split('\n')
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i]
                const hit = spec.patternMode === 'regex'
                    ? new RegExp(spec.pattern).test(line)
                    : line.includes(spec.pattern)
                if (hit) {
                    const snippet = line.length > 300 ? line.slice(0, 300) + '...' : line
                    return {
                        fired: true,
                        evidence: `文件第 ${i + 1} 行命中规则 "${spec.pattern}"：\n${snippet}`,
                        state: { exists: true, ...currentStat },
                        nextCheckAt: now + 86400000,
                    }
                }
            }
        }

        return { fired: false, nextCheckAt }
    },
}

export default FileCondition
