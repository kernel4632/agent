/*
 * 定时器条件：等待指定秒数后触发。
 *
 * 调用示例：
 *   const spec = TimerCondition.normalize({ kind: 'timer', afterSeconds: 60 })
 *   const state = await TimerCondition.start(spec)
 *   const result = await TimerCondition.check(spec, state)
 */

const TimerCondition = {
    kind: 'timer',                             // 条件标识
    label: '定时等待',                         // 人类可读标签

    normalize(raw = {}) {
        const after = Number(raw.afterSeconds ?? raw.after_seconds)
        if (isNaN(after) || after < 1) {
            throw new Error('timer 条件必须传入正整数 afterSeconds（至少 1 秒）')
        }
        return {
            kind: 'timer',
            afterSeconds: Math.floor(after),
        }
    },

    describe(spec) {
        return `等待 ${spec.afterSeconds} 秒`
    },

    async start(spec) {
        return { targetAt: Date.now() + spec.afterSeconds * 1000 }
    },

    async check(spec, state) {
        const now = Date.now()
        const targetAt = Number(state.targetAt || 0)

        if (now >= targetAt) {
            return {
                fired: true,
                evidence: `定时时间到达（设定 ${spec.afterSeconds} 秒）`,
                nextCheckAt: now + 86400000,
            }
        }

        return {
            fired: false,
            nextCheckAt: targetAt,
        }
    },
}

export default TimerCondition
