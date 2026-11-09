/*
 * 工具审批：按权限规则放行工具，或在规则要求询问时等用户决定。
 *
 * 这是工具执行的唯一一道关口。deny 是硬规则；没有会话级自动批准。
 * 规则动作有四种：allow 直接执行，review 先问 AI 审核器，ask 等用户决定，deny 直接拒绝。
 * review 的结论是 allow / deny / ask：只有 allow 直接执行，deny 直接拒绝，
 * ask、超时、审核器故障都回到人工审批，绝不静默放行。
 * 对象规则里的 `*` 是这个工具的默认动作，不拿去对参数做通配。
 * 其余模式才按参数匹配，并且 `*` 跨过斜杠和换行，所以“始终允许”能盖住同一类命令。
 * 全局 `*` 为 allow 是「全部批准」：工具默认写成 ask / review 也不能把多行命令打回弹窗，只有明确的 deny 能拦住。
 * 规则已经是 allow 的调用直接放行，不再因为重复出现而停下来问。
 * 文件快照不在这里实现：放行时只调用工具自己的 snapshot 钩子，由文件工具决定存什么。
 * 工具查询、配置保存和审核器由命令层在启动时 bind；本文件不 import 任何 feature。
 *
 * 调用示例：
 *   Approval.bind({ tool, config, review })                // 命令层启动时注入
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
const normalize = value => value === 'allow' ? 'allow' : value === 'deny' ? 'deny' : value === 'review' ? 'review' : 'ask'

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

// --- 按规则决定放行、询问还是拒绝 ---
const decideByRules = (toolName, matchValue, rules = store.config.permission || { '*': 'ask' }) => {
    const toolRule = rules[toolName]
    const fallback = normalize(rules['*'])
    let decision = fallback
    let patterns = null
    if (typeof toolRule === 'string') decision = normalize(toolRule)
    if (toolRule && typeof toolRule === 'object' && !Array.isArray(toolRule)) {
        // `*` 是这个工具的默认动作。设置页的“自动执行”写的就是它，不能再要求参数真的匹配到星号。
        if ('*' in toolRule) decision = normalize(toolRule['*'])
        patterns = toolRule
    }
    // 多行脚本经常对不上「cd /tmp*」这种前缀。工具默认是 ask 时会弹窗。
    // 全部批准把全局写成 allow，这一层必须盖过工具默认的 ask / review；deny 仍然是硬规则。
    if (fallback === 'allow' && (decision === 'ask' || decision === 'review')) decision = 'allow'
    if (patterns) {
        // 最后一条命中的说了算，deny 可以盖过前面的允许。全部批准时，命中 ask / review 不再把结果打回弹窗。
        for (const [pattern, result] of Object.entries(patterns)) {
            if (!matchPattern(matchValue, pattern)) continue
            const matched = normalize(result)
            if ((matched === 'ask' || matched === 'review') && fallback === 'allow') continue
            decision = matched
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

// --- 这个工具自己的默认动作：先看工具规则，再看全局规则 ---
const defaultActionOf = (toolName, rules = effectiveRules()) => {
    const rule = rules[toolName]
    if (typeof rule === 'string') return normalize(rule)
    if (plainObject(rule) && '*' in rule) return normalize(rule['*'])
    return normalize(rules['*'])
}

// --- 把"始终允许"写成一条全局规则 ---
const remember = ({ toolName, input, matchValue }) => {
    const pattern = toolName === 'execute_command' ? `${normalizeCommand(input.command)}*` : matchValue
    // 精确参数里的 glob 特殊字符按字面量转义，模式才能匹配回保存时的原值；
    // 反斜杠在 bash 模式下是字面量，不进字符类——否则模式永远匹配不上 Windows 路径（issue #9）。
    // execute_command 的命令前缀模式以 * 结尾表示"这类命令都放行"，这个星号是通配，不转义。
    const escaped = (toolName === 'execute_command' ? pattern : pattern.replace(/\*/g, '\\*'))
        .replace(/\\/g, '\\\\')
        .replace(/[?[\]{()}]/g, character => `\\${character}`)
    store.config.permission = plainObject(store.config.permission) || { '*': 'ask' }
    const toolRule = plainObject(store.config.permission[toolName])
    if (toolRule) toolRule[escaped] = 'allow'
    else {
        // 工具原本是 AI 审核时，记住一个参数不能让同工具的其他参数降级成人工询问。
        const toolDefault = defaultActionOf(toolName) === 'review' ? 'review' : 'ask'
        store.config.permission[toolName] = { '*': toolDefault, [escaped]: 'allow' }
    }
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

// --- AI 审核放行：允许时没有弹窗，这条事件是唯一的“谁放行的”说明 ---
const announceReview = ({ sessionId, toolCallId, name, input, review }) => {
    if (!sessionId) return
    return SSE.send({ id: sessionId, data: { type: 'permission-review', callID: toolCallId, tool: name, input, reviewer: 'llm', decision: review.decision, reason: review.reason } })
}

// --- AI 审核拒绝：复用权限拒绝事件，前端不用多一条展示路径 ---
const blockByReview = ({ sessionId, toolCallId, name, input, review }) => {
    if (!sessionId) return
    return SSE.send({
        id: sessionId,
        data: {
            type: 'permission-blocked',
            callID: toolCallId,
            tool: name,
            input,
            reason: `AI 审核拒绝：${review.reason || '未说明原因'}`,
            review: { reviewer: 'llm', decision: 'deny', reason: review.reason },
        },
    })
}

// --- 把审批请求推给界面，等用户回答；任务被取消时按拒绝处理 ---
const waitForUser = ({ sessionId, toolCallId, name, input, matchValue, signal, review }) => new Promise(resolve => {
    approvals.set(`${sessionId}:${toolCallId}`, { sessionId, toolCallId, toolName: name, input, matchValue, review, signal, resolve })
    const event = { type: 'permission', callID: toolCallId, tool: name, input }
    if (review) event.review = { reviewer: 'llm', decision: 'ask', reason: review.reason }
    SSE.send({ id: sessionId, data: event })
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

    // allow 就是放行。重复出现同一次调用不再改回询问，否则自动执行形同失效。
    if (rules.decision === 'allow') return allow({ sessionId, messageId, toolCallId, toolName: name, input })

    let review = null
    if (rules.decision === 'review') {
        review = services.review
            ? await services.review.check({ sessionId, toolCallId, toolName: name, input, signal })
            : { decision: 'ask', reason: '没有配置审核器' }
        if (signal?.aborted) return false
        if (review.decision === 'allow') {
            await announceReview({ sessionId, toolCallId, name, input, review })
            return allow({ sessionId, messageId, toolCallId, toolName: name, input })
        }
        if (review.decision === 'deny') {
            await blockByReview({ sessionId, toolCallId, name, input, review })
            return false
        }
        // review 说 ask：继续走人工审批，把 AI 的原因带在弹窗里。
    }

    // 没有会话上下文时按无人值守放行。
    if (!sessionId || !toolCallId) return allow({ sessionId, messageId, toolCallId, toolName: name, input })
    if (signal?.aborted) return false

    const answer = await waitForUser({ sessionId, toolCallId, name, input, matchValue, signal, review })
    if (!answer) return false
    return allow({ sessionId, messageId, toolCallId, toolName: name, input })
}

// --- 列出这个会话还在等谁批准 ---
const pending = sessionId => [...approvals.entries()]
    .filter(([, approval]) => approval.sessionId === sessionId)
    .map(([key, approval]) => ({
        callID: key.slice(sessionId.length + 1),
        tool: approval.toolName,
        input: approval.input,
        ...(approval.review ? { review: { reviewer: 'llm', decision: 'ask', reason: approval.review.reason } } : {}),
    }))

// --- 配置变了就重问：按新规则重新评估还挂着的审批 ---
// 用户先遇到弹窗、再去设置页开“全部批准”，回来时任务还卡在原来那个弹窗上——
// 挂起的审批必须跟新配置走，否则自动批准永远救不回已经挂住的任务。
const recheck = () => {
    const rules = effectiveRules()
    for (const [key, approval] of approvals) {
        const decision = decideByRules(approval.toolName, approval.matchValue, rules)
        if (decision === 'ask') continue
        if (decision === 'review') {
            // 用户把等待中的调用改成了 AI 审核：先拿掉登记，审核结论回来后按结果结算。
            approvals.delete(key)
            if (!services.review) {
                approvals.set(key, approval)
                continue
            }
            void services.review.check({
                sessionId: approval.sessionId,
                toolCallId: approval.toolCallId,
                toolName: approval.toolName,
                input: approval.input,
                signal: approval.signal,
            }).then(async review => {
                if (approval.signal?.aborted) {
                    approval.resolve(false)
                    return
                }
                if (review.decision === 'allow') {
                    await announceReview({ sessionId: approval.sessionId, toolCallId: approval.toolCallId, name: approval.toolName, input: approval.input, review })
                    approval.resolve(true)
                    return
                }
                if (review.decision === 'deny') {
                    await blockByReview({ sessionId: approval.sessionId, toolCallId: approval.toolCallId, name: approval.toolName, input: approval.input, review })
                    approval.resolve(false)
                    return
                }
                // AI 也不确定：把登记放回去，原来的弹窗继续等用户。
                approvals.set(key, approval)
            }).catch(() => {
                approvals.set(key, approval)
            })
            continue
        }
        approvals.delete(key)
        if (decision === 'deny') {
            SSE.send({ id: approval.sessionId, data: { type: 'permission-blocked', callID: approval.toolCallId, tool: approval.toolName, input: approval.input, reason: '被权限规则拒绝' } })
        }
        approval.resolve(decision !== 'deny')
    }
}

// --- 接收用户在界面上做的决定 ---
const decide = async ({ sessionId, toolCallId, decision }) => {
    const approval = approvals.get(`${sessionId}:${toolCallId}`)
    if (!approval) return { ok: false }
    if (!['allow-once', 'allow-always', 'deny'].includes(decision)) {
        throw fail(400, `decision must be allow-once, allow-always or deny, got: ${decision}`)
    }

    approvals.delete(`${sessionId}:${toolCallId}`)
    if (decision === 'allow-always') {
        remember({ toolName: approval.toolName, input: approval.input, matchValue: approval.matchValue }) // 把这条规则写进内存配置
        await services.config.save()                                                                       // 规则立刻落盘，下次启动仍然生效
    }
    approval.resolve(decision !== 'deny')
    return { ok: true }
}

const remove = sessionId => {
    for (const [key, approval] of approvals) {
        if (approval.sessionId !== sessionId) continue
        approvals.delete(key)
    }
}

export default { check, decide, pending, recheck, remove, bind }
