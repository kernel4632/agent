/*
 * 工具审批：按权限规则放行工具，或在规则要求询问时等用户决定。
 *
 * 这是工具执行的唯一一道关口。deny 是硬规则；没有会话级自动批准。
 * 同一个工具调用连续出现三次时，会停下来问一次。
 * 文件快照不在这里实现：放行时只调用工具自己的 snapshot 钩子，由文件工具决定存什么。
 * 工具查询和配置保存由命令层在启动时 bind；本文件不 import 任何 feature。
 *
 * 调用示例：
 *   Approval.bind({ tool, config })                        // 命令层启动时注入
 *   const allowed = await Approval.check({ sessionId, messageId, toolCallId, toolName, input, signal })
 *   await Approval.decide({ sessionId, toolCallId, decision: 'allow-once' })
 *   Approval.pending(sessionId)
 */

import picomatch from 'picomatch'
import store from '../store.js'
import fail from '../utils/fail.js'
import SSE from '../utils/sse.js'

// 工具查询和配置保存在命令层启动时注入；本文件不 import 别的 feature。
let services = {}
const bind = value => { services = value }

// 同一个工具调用连续出现这么多次，就停下来问一次。
const LOOP_LIMIT = 3

// 等用户决定的工具调用：key 是 `${sessionId}:${toolCallId}`，value 里带着唤醒 Agent 的 resolve。
const approvals = new Map()
// 每个会话最近一次工具调用和连续次数。
const recentCalls = new Map()

// --- 把参数变成稳定的字符串，键的顺序不影响结果 ---
const stableKey = value => {
    if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableKey(value[key])}`).join(',')}}`
    }
    return JSON.stringify(value)
}

// --- 把工具参数摊平成一行文字，供规则里的模式比对 ---
const flattenInput = value => {
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

// --- 认不出的写法一律按"询问"处理 ---
const normalize = value => value === 'allow' ? 'allow' : value === 'deny' ? 'deny' : 'ask'

// --- 按规则决定放行、询问还是拒绝 ---
const decideByRules = (toolName, matchValue, rules = store.config.permission || { '*': 'ask' }) => {
    const toolRule = rules[toolName]
    let decision = normalize(rules['*'])
    if (typeof toolRule === 'string') decision = normalize(toolRule)
    if (toolRule && typeof toolRule === 'object' && !Array.isArray(toolRule)) {
        // 对象形式的规则按参数匹配：最后一条命中的模式说了算。
        for (const [pattern, result] of Object.entries(toolRule)) {
            if (picomatch.isMatch(matchValue, pattern, { bash: true, dot: true })) decision = normalize(result)
        }
    }
    return decision
}

// --- 这次会话实际生效的权限规则 ---
const effectiveRules = () => store.config.permission || { '*': 'ask' }

// 用户心里认为的"一个操作"：换参数还是同一个操作，换子命令才是另一个操作。
// 取前两个词就够了：`bun test`、`make deploy` 是两个操作，`ls -la` 仍是 `ls`。
const normalizeCommand = command => {
    const words = String(command).trim().split(/\s+/)
    const second = words[1] || ''
    return !second || second.startsWith('-') ? words[0] : `${words[0]} ${second}`
}

const plainObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null

// --- 把"始终允许"写成一条全局规则 ---
const remember = ({ toolName, input, matchValue }) => {
    const pattern = toolName === 'execute_command' ? `${normalizeCommand(input.command)}*` : matchValue
    const escaped = pattern.replace(/[\\?[\]{()]/g, character => `[${character}]`)
    store.config.permission = plainObject(store.config.permission) || { '*': 'ask' }
    const toolRule = plainObject(store.config.permission[toolName])
    if (toolRule) toolRule[escaped] = 'allow'
    else store.config.permission[toolName] = { '*': 'ask', [escaped]: 'allow' }
}

// --- 放行这次调用，并让工具自己决定是否在写入前存快照 ---
const allow = async ({ sessionId, messageId, toolCallId, toolName, input }) => {
    await services.tool.snapshot({
        sessionId,
        messageId,
        toolCallId,
        toolName,
        input,
        cwd: store.sessions[sessionId]?.cwd || process.cwd(),
    })
    return true
}

// --- 这次会话生效的规则：deny 时把原因告诉界面 ---
const ruleDecision = async ({ sessionId, toolCallId, name, matchValue, input }) => {
    const decision = decideByRules(name, matchValue, effectiveRules())
    if (decision !== 'deny') return { decision, denied: false }
    if (sessionId) await SSE.send({ id: sessionId, data: { type: 'permission-blocked', callID: toolCallId, tool: name, input, reason: '被权限规则拒绝' } })
    return { decision, denied: true }
}

// --- 同一个调用连续出现时先停下来问一次 ---
const repeatsTooOften = ({ sessionId, name, input }) => {
    if (!sessionId) return false
    const key = `${name}:${stableKey(input)}`
    const previous = recentCalls.get(sessionId)
    const count = previous?.key === key ? previous.count + 1 : 1
    recentCalls.set(sessionId, { key, count })
    const looping = count >= LOOP_LIMIT
    if (looping) {
        SSE.send({ id: sessionId, data: { type: 'permission-limit', limit: LOOP_LIMIT, reason: `同一个工具调用连续出现 ${LOOP_LIMIT} 次，确认要继续吗` } })
    }
    return looping
}

// --- 把审批请求推给界面，等用户回答；任务被取消时按拒绝处理 ---
const waitForUser = ({ sessionId, toolCallId, name, input, matchValue, signal }) => new Promise(resolve => {
    approvals.set(`${sessionId}:${toolCallId}`, { sessionId, toolName: name, input, matchValue, resolve })
    SSE.send({ id: sessionId, data: { type: 'permission', callID: toolCallId, tool: name, input } })
    signal?.addEventListener('abort', () => {
        approvals.delete(`${sessionId}:${toolCallId}`)
        resolve(false)
    }, { once: true })
})

// --- 检查一个工具调用能不能执行 ---
const check = async ({ sessionId, messageId, toolCallId, toolName, input = {}, signal }) => {
    const name = toolName
    const mcpServers = Object.keys(store.config.mcp || {})
    // 直接调用审批（测试、脚本）时工具表可能还没装配，这里补一次扫描。
    await services.tool.ready()

    // 记清单、结束循环这些内部工具不碰磁盘，也没有"要不要批准"这回事。
    if (services.tool.kindOf({ toolName: name, mcpServers }) === 'never') {
        return allow({ sessionId, messageId, toolCallId, toolName: name, input })
    }

    const matchValue = flattenInput(input)
    const rules = await ruleDecision({ sessionId, toolCallId, name, matchValue, input })
    if (rules.denied) return false

    // 同一个调用连续出现三次时，即使规则说 allow 也停下来问一次。
    const looping = repeatsTooOften({ sessionId, name, input })
    const rule = looping ? 'ask' : rules.decision
    if (rule === 'allow') return allow({ sessionId, messageId, toolCallId, toolName: name, input })

    // 没有会话上下文时按无人值守放行。
    if (!sessionId || !toolCallId) return allow({ sessionId, messageId, toolCallId, toolName: name, input })

    const answer = await waitForUser({ sessionId, toolCallId, name, input, matchValue, signal })
    if (!answer) return false
    return allow({ sessionId, messageId, toolCallId, toolName: name, input })
}

// --- 列出这个会话还在等谁批准 ---
const pending = sessionId => [...approvals.entries()]
    .filter(([, approval]) => approval.sessionId === sessionId)
    .map(([key, approval]) => ({ callID: key.slice(sessionId.length + 1), tool: approval.toolName, input: approval.input }))

// --- 接收用户在界面上做的决定 ---
const decide = async ({ sessionId, toolCallId, decision }) => {
    const approval = approvals.get(`${sessionId}:${toolCallId}`)
    if (!approval) return { ok: false }
    if (!['allow-once', 'allow-always', 'deny'].includes(decision)) {
        throw fail(400, `decision must be allow-once, allow-always or deny, got: ${decision}`)
    }

    approvals.delete(`${sessionId}:${toolCallId}`)
    recentCalls.delete(sessionId)
    if (decision === 'allow-always') {
        remember({ toolName: approval.toolName, input: approval.input, matchValue: approval.matchValue }) // 把这条规则写进内存配置
        await services.config.save()                                                                       // 规则立刻落盘，下次启动仍然生效
    }
    approval.resolve(decision !== 'deny')
    return { ok: true }
}

// --- 发新消息时重新开始重复调用计数 ---
const reset = sessionId => {
    recentCalls.delete(sessionId)
}

const remove = sessionId => {
    for (const [key, approval] of approvals) {
        if (approval.sessionId !== sessionId) continue
        approvals.delete(key)
    }
    recentCalls.delete(sessionId)
}

export default { check, decide, pending, reset, remove, bind }
