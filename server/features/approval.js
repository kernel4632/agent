/*
 * 工具审批：按权限规则放行工具，或在规则要求询问时等用户决定。
 *
 * 这是工具执行的唯一一道关口，所以忽略规则也在这里判断一次，读文件和执行命令都绕不过它。
 * 规则写在配置文件的 permission 字段里，规则为空时所有工具都先问用户。
 * 调用示例：
 *   const allowed = await Approval.check({ sessionId, messageId, toolCallId, toolName, input, signal })
 *   // allowed = true | false
 *   await Approval.decide({ sessionId, toolCallId, decision: 'allow-once' })
 *   // decision 只能是 allow-once / allow-always / deny
 */

import picomatch from 'picomatch'
import Config from '../commands/config.js' // 权限规则就写在配置里，不再单独存一份。
import Path from '../utils/path.js' // 记住"始终允许"后要写回配置文件。
import Ignore from './ignore.js' // 敏感文件不许碰，配置改不掉。
import Snapshot from './snapshot.js' // 工具改文件之前先存一份原样。
import Store from '../store.js' // 直接访问等待用户决定的审批表。
import SSE from '../utils/sse.js' // 把审批请求推给前端。
import fail from '../utils/fail.js' // 用户选了不认识的决定时按填错处理。

// --- 把工具参数压成一行文字 ---
const flatten = value => {
    // 规则里的模式要和参数对比，所以参数里的路径、命令都摊平成一行。
    const values = []
    const pending = [value]
    while (pending.length) {
        const current = pending.shift()
        if (Array.isArray(current)) pending.push(...current)
        else if (current && typeof current === 'object') pending.push(...Object.values(current))
        else values.push(String(current))
    }
    return values.join(' ')
}

// --- 按规则决定放行还是询问 ---
const decideByRules = (toolName, matchValue) => {
    // 没有规则时先问用户，不自动执行任何工具。
    const rules = Config.get().permission || { '*': 'ask' }
    const toolRule = rules[toolName]
    let action = rules['*'] === 'allow' ? 'allow' : 'ask' // 全局规则只是起点，具体工具可以覆盖它。

    if (typeof toolRule === 'string') action = toolRule === 'allow' ? 'allow' : 'ask' // 工具自己的规则优先。
    if (toolRule && typeof toolRule === 'object' && !Array.isArray(toolRule)) {
        // 对象形式的规则按参数匹配：最后一条命中的模式说了算。
        for (const [pattern, result] of Object.entries(toolRule)) {
            if (picomatch.isMatch(matchValue, pattern, { bash: true, dot: true })) action = result === 'allow' ? 'allow' : 'ask'
        }
    }
    return action
}

// --- 把"始终允许"的参数写成规则 ---
const remember = (toolName, matchValue) => {
    // 参数里可能出现通配符，先转义，保证这条规则只命中同一类参数。
    const escaped = matchValue.replace(/[\\*?[\]{}()]/g, character => `[${character}]`)
    const rules = Config.get().permission
    const toolRule = rules[toolName]
    if (toolRule && typeof toolRule === 'object' && !Array.isArray(toolRule)) toolRule[escaped] = 'allow'
    else rules[toolName] = { '*': 'ask', [escaped]: 'allow' }
}

// --- 检查工具是否放行 ---
const check = async ({ sessionId, messageId, toolCallId, toolName, input = {}, signal }) => {
    // Agent 只看这个返回值是不是 true，所以这里必须返回布尔值，不能返回对象。
    // 被拦住的原因通过 SSE 告诉界面，让用户知道是哪条规则挡下的。
    if (Ignore.blocks({ toolName, input })) {
        await SSE.send({ id: sessionId, data: { type: 'permission-blocked', tool: toolName, input, reason: 'ignored path' } })
        return false
    }

    const matchValue = flatten(input)
    const rule = decideByRules(toolName, matchValue)

    // 改文件的工具在真正执行之前存一份原样，回退时才有东西可恢复。
    if (rule === 'allow') return allow({ sessionId, messageId, toolName, input })

    // 规则要求询问时，这里发出审批请求并等 Approval.decide 回答。
    if (!sessionId || !toolCallId) return allow({ sessionId, messageId, toolName, input }) // 没有会话上下文时按无人值守放行，避免任务卡死。

    const decision = await new Promise(resolve => {
        Store.approvals.set(`${sessionId}:${toolCallId}`, { sessionId, toolName, input, matchValue, resolve })
        SSE.send({ id: sessionId, data: { type: 'permission', callID: toolCallId, tool: toolName, input } })
        signal?.addEventListener('abort', () => {
            // 任务被取消时，这条审批永远不会有人回答，直接按拒绝处理并把 Agent 唤醒。
            Store.approvals.delete(`${sessionId}:${toolCallId}`)
            resolve(false)
        }, { once: true })
    })
    if (!decision) return false
    return allow({ sessionId, messageId, toolName, input })
}

// --- 放行并留下快照 ---
const allow = async ({ sessionId, messageId, toolName, input }) => {
    // 快照要在工具执行之前记录，记下的才是被修改之前的文件内容。
    await Snapshot.save({ sessionId, messageId, toolName, input })
    return true
}

// --- 接收用户决定 ---
const decide = async ({ sessionId, toolCallId, decision }) => {
    const approval = Store.approvals.get(`${sessionId}:${toolCallId}`)
    if (!approval) return { ok: false } // 已经超时或被取消的审批不再处理。
    if (!['allow-once', 'allow-always', 'deny'].includes(decision)) throw fail(400, `decision must be allow-once, allow-always or deny, got: ${decision}`)

    Store.approvals.delete(`${sessionId}:${toolCallId}`)
    if (decision === 'allow-always') {
        // 记住这类参数，并把规则写回配置文件，重启后依然生效。
        remember(approval.toolName, approval.matchValue)
        await Config.save(Path.config())
    }
    approval.resolve(decision !== 'deny') // 允许一次和始终允许都放行本次调用。
    return { ok: true }
}

export default { check, decide }
