/*
 * 上下文用量台账和 ctx_usage 工具。
 *
 * 重点是三件事：数字要算对（压缩点、余量、百分比），没有数据时不许编，
 * 以及换会话不能串数据。
 * 运行：cd server && bun test tests/context-usage.test.js
 */
import { describe, expect, test } from 'bun:test'

import ContextUsage from '../utils/context-usage.js'
import ctxUsage from '../tools/context.js'

describe('上下文用量台账', () => {
    test('记下一轮用量后能算出压缩点和余量', () => {
        ContextUsage.record('s-usage', { tokens: 60000, budget: 128000, compactThreshold: 0.8 })
        const read = ContextUsage.read('s-usage')
        expect(read.tokens).toBe(60000)
        expect(read.budget).toBe(128000)
        expect(read.compactAt).toBe(102400)
        expect(read.untilCompact).toBe(42400)
        expect(read.percentOfBudget).toBe(46.9)
        ContextUsage.remove('s-usage')
    })

    test('没有采样时返回 null，不编数字', () => {
        expect(ContextUsage.read('s-never-run')).toBeNull()
    })

    test('脏值（NaN、预算为 0）不写入，避免把假数字交给模型', () => {
        ContextUsage.record('s-dirty', { tokens: Number.NaN, budget: 128000 })
        ContextUsage.record('s-dirty', { tokens: 100, budget: 0 })
        expect(ContextUsage.read('s-dirty')).toBeNull()
    })

    test('不同的会话互不干扰', () => {
        ContextUsage.record('s-a', { tokens: 1000, budget: 10000 })
        ContextUsage.record('s-b', { tokens: 9000, budget: 10000 })
        expect(ContextUsage.read('s-a').tokens).toBe(1000)
        expect(ContextUsage.read('s-b').tokens).toBe(9000)
        ContextUsage.remove('s-a')
        ContextUsage.remove('s-b')
    })

    test('删掉之后读不到', () => {
        ContextUsage.record('s-gone', { tokens: 10, budget: 100 })
        ContextUsage.remove('s-gone')
        expect(ContextUsage.read('s-gone')).toBeNull()
    })
})

describe('ctx_usage 工具', () => {
    test('没有数据时如实说没有，附上怎么办', async () => {
        const result = await ctxUsage.execute({}, { sessionId: 's-none' })
        expect(result.available).toBe(false)
        expect(result.note).toContain('No model request')
    })

    test('有数据时给出用量和可执行的建议', async () => {
        ContextUsage.record('s-ok', { tokens: 95000, budget: 128000, compactThreshold: 0.8 })
        const result = await ctxUsage.execute({}, { sessionId: 's-ok' })
        expect(result.available).toBe(true)
        expect(result.tokens).toBe(95000)
        // 压缩点 102400，余量 7400，不到 10% 预算，应该提示收口
        expect(result.untilCompact).toBe(7400)
        expect(result.advice).toContain('Close to compaction')
        ContextUsage.remove('s-ok')
    })

    test('已过压缩点时提示落盘', async () => {
        ContextUsage.record('s-over', { tokens: 110000, budget: 128000, compactThreshold: 0.8 })
        const result = await ctxUsage.execute({}, { sessionId: 's-over' })
        expect(result.untilCompact).toBeLessThan(0)
        expect(result.advice).toContain('compaction point')
        ContextUsage.remove('s-over')
    })

    test('转给模型的文本带具体数字，不是一坨 JSON', () => {
        const text = ctxUsage.toModelOutput({ output: {
            available: true, tokens: 50000, budget: 100000, compactAt: 80000,
            untilCompact: 30000, percentOfBudget: 50, advice: 'Plenty of room left.',
        } })
        expect(text.type).toBe('text')
        expect(text.value).toContain('50000 of 100000')
        expect(text.value).toContain('50%')
        expect(text.value).toContain('30000 tokens left')
        expect(text.value).not.toContain('{')
    })
})
