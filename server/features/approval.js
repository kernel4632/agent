/*
 * 工具审批：按权限规则放行工具，或在规则要求询问时等用户决定。
 *
 * 这是工具执行的唯一一道关口。deny 是硬规则；没有会话级自动批准。
 * 对象规则里的 `*` 是这个工具的默认动作，不拿去对参数做通配。
 * 其余模式才按参数匹配，并且 `*` 跨过斜杠和换行，所以“始终允许”能盖住同一类命令。
 * 全局 `*` 为 allow 是「全部批准」：工具默认写成 ask 也不能把多行命令打回弹窗，只有明确的 deny 能拦住。
 * 规则已经是 allow 的调用直接放行，不再因为重复出现而停下来问。
 * 文件快照不在这里实现：放行时只调用工具自己的 snapshot 钩子，由文件工具决定存什么。
 * 工具查询（快照、扫描、类别）由调用方传入；本文件不 import 任何 feature。
 *
 * 调用示例：
 *   const allowed = await Approval.check({ sessionId, messageId, toolCallId, toolName, input, signal,
 *       snapshot: Tool.snapshot, ready: Tool.ready, kindOf: Tool.kind })
 *   await Approval.decide({ sessionId, toolCallId, decision: 'allow-once' })
 *   Approval.pending(sessionId)
 */

import picomatch from 'picomatch'
import store from '../store.js'
import fail from '../utils/fail.js'
import SSE from '../utils/sse.js'

// 工具查询（快照、扫描、类别）由调用方传入；本文件不 import 任何 feature。

// 等用户决定的工具调用：key 是 `${sessionId}:${toolCallId}`，value 里带着唤醒 Agent 的 resolve。
const approvals = new Map()

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

// picomatch 的 * 不跨 `/` 和换行。权限比的是命令和参数原文，先换成同一个占位再匹配。
const loosen = value => String(value).replace(/[/\r\n]/g, '\u0001')

const matchPattern = (value, pattern) => {
    if (!pattern || pattern === '*') return false
    try {
        return picomatch.isMatch(loosen(value), loosen(pattern), { bash: true, dot: true, windows: false, fastpaths: false })
    } catch {
        return false
    }
}

// --- MCP 工具按服务名前缀识别，允许用一个 mcp 开关统一批准 ---
const isMcpTool = toolName => Object.keys(store.config.mcp || {}).some(server => toolName.startsWith(`${server}_`))

// --- 按规则决定放行、询问还是拒绝 ---
const decideByRules = (toolName, matchValue, rules = store.config.permission || { '*': 'ask' }) => {
    const fallback = normalize(rules['*'])
    let decision = fallback
    let patterns = null
    const applyRule = rule => {
        if (typeof rule === 'string') decision = normalize(rule)
        if (rule && typeof rule === 'object' && !Array.isArray(rule)) {
            // `*` 是这个组的默认动作；参数模式在下面继续匹配。
            if ('*' in rule) decision = normalize(rule['*'])
            return rule
        }
        return null
    }
    // 一个 mcp 开关统管全部 MCP 工具：组规则存在时，旧的单工具规则不再拆台。
    if (isMcpTool(toolName) && rules.mcp !== undefined) {
        patterns = applyRule(rules.mcp)
    } else if (rules[toolName] !== undefined) {
        patterns = applyRule(rules[toolName])
    }
    // 多行脚本经常对不上「cd /tmp*」这种前缀。工具默认是 ask 时会弹窗。
    // 全部批准把全局写成 allow，这一层必须盖过工具默认的 ask；deny 仍然是硬规则。
    if (fallback === 'allow' && decision === 'ask') decision = 'allow'
    if (patterns) {
        // 最后一条命中的说了算，deny 可以盖过前面的允许。全部批准时，命中 ask 不再把结果打回弹窗。
        for (const [pattern, result] of Object.entries(patterns)) {
            if (pattern === '*') continue
            if (!matchPattern(matchValue, pattern)) continue
            const matched = normalize(result)
            if (matched === 'ask' && fallback === 'allow') continue
            decision = matched
        }
    }
    return decision
}

// --- 这次会话实际生效的权限规则 ---
const effectiveRules = () => store.config.permission || { '*': 'ask' }

// 用户心里认为的"一个操作"：换参数还是同一个操作，换子命令才是另一个操作。

// --- 放行这次调用，并让工具自己决定是否在写入前存快照 ---
const allow = async ({ sessionId, messageId, toolCallId, toolName, input, snapshot }) => {
    await snapshot({
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
const check = async ({ sessionId, messageId, toolCallId, toolName, input = {}, signal, snapshot, ready, kindOf }) => {
    const name = toolName
    const mcpServers = Object.keys(store.config.mcp || {})
    // 直接调用审批（测试、脚本）时工具表可能还没装配，这里补一次扫描。
    await ready()

    // 记清单、结束循环这些内部工具不碰磁盘，也没有"要不要批准"这回事。
    if (kindOf({ toolName: name, mcpServers }) === 'never') {
        return allow({ sessionId, messageId, toolCallId, toolName: name, input, snapshot })
    }

    const matchValue = flattenInput(input)
    const rules = await ruleDecision({ sessionId, toolCallId, name, matchValue, input })
    if (rules.denied) return false

    // allow 就是放行。重复出现同一次调用不再改回询问，否则自动执行形同失效。
    if (rules.decision === 'allow') return allow({ sessionId, messageId, toolCallId, toolName: name, input, snapshot })

    // 没有会话上下文时按无人值守放行。
    if (!sessionId || !toolCallId) return allow({ sessionId, messageId, toolCallId, toolName: name, input, snapshot })

    const answer = await waitForUser({ sessionId, toolCallId, name, input, matchValue, signal })
    if (!answer) return false
    return allow({ sessionId, messageId, toolCallId, toolName: name, input, snapshot })
}

// --- 列出这个会话还在等谁批准 ---
const pending = sessionId => [...approvals.entries()]
    .filter(([, approval]) => approval.sessionId === sessionId)
    .map(([key, approval]) => ({ callID: key.slice(sessionId.length + 1), tool: approval.toolName, input: approval.input }))

// --- 配置变了就重问：按新规则重新评估还挂着的审批 ---
// 用户先遇到弹窗、再去设置页开“全部批准”，回来时任务还卡在原来那个弹窗上——
// 挂起的审批必须跟新配置走，否则自动批准永远救不回已经挂住的任务。
const recheck = () => {
    const rules = effectiveRules()
    for (const [key, approval] of approvals) {
        const decision = decideByRules(approval.toolName, approval.matchValue, rules)
        if (decision === 'ask') continue
        approvals.delete(key)
        if (decision === 'deny') {
            SSE.send({ id: approval.sessionId, data: { type: 'permission-blocked', callID: approval.toolCallId, tool: approval.toolName, input: approval.input, reason: '被权限规则拒绝' } })
        }
        approval.resolve(decision !== 'deny')
    }
}

// --- 接收用户在界面上做的决定 ---
// 只有两个值：放行这一次，或拒绝这一次。长期规则不在这里写——
// “始终允许”属于工具自动批准，它直接改 config.permission，不走弹窗。
const decide = async ({ sessionId, toolCallId, decision }) => {
    const approval = approvals.get(`${sessionId}:${toolCallId}`)
    if (!approval) return { ok: false }
    if (decision !== 'allow' && decision !== 'deny') {
        throw fail(400, `decision must be allow or deny, got: ${decision}`)
    }

    approvals.delete(`${sessionId}:${toolCallId}`)
    approval.resolve(decision === 'allow')
    return { ok: true }
}

const remove = sessionId => {
    for (const [key, approval] of approvals) {
        if (approval.sessionId !== sessionId) continue
        approvals.delete(key)
    }
}

export default { check, decide, pending, recheck, remove }
