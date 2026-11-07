/*
 * 工具审批：按权限规则放行工具，或在规则要求询问时等用户决定。
 *
 * 这是工具执行的唯一一道关口。deny 是硬规则；没有会话级自动批准。
 * 对象规则里的 `*` 是这个工具的默认动作，不拿去对参数做通配。
 * 其余模式才按参数匹配，并且 `*` 跨过斜杠和换行，所以“始终允许”能盖住同一类命令。
 * 规则已经是 allow 的调用直接放行，不再因为重复出现而停下来问。
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

// --- 按规则决定放行、询问还是拒绝 ---
const decideByRules = (toolName, matchValue, rules = store.config.permission || { '*': 'ask' }) => {
    const toolRule = rules[toolName]
    let decision = normalize(rules['*'])
    if (typeof toolRule === 'string') decision = normalize(toolRule)
    if (toolRule && typeof toolRule === 'object' && !Array.isArray(toolRule)) {
        // `*` 是这个工具的默认动作。设置页的“自动执行”写的就是它，不能再要求参数真的匹配到星号。
        if ('*' in toolRule) decision = normalize(toolRule['*'])
        // 其余模式按参数匹配：最后一条命中的说了算，可以覆盖上面的默认动作。
        for (const [pattern, result] of Object.entries(toolRule)) {
            if (matchPattern(matchValue, pattern)) decision = normalize(result)
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
    // 精确参数里的 glob 特殊字符按字面量转义，模式才能匹配回保存时的原值；
    // 反斜杠在 bash 模式下是字面量，不进字符类——否则模式永远匹配不上 Windows 路径（issue #9）。
    // execute_command 的命令前缀模式以 * 结尾表示"这类命令都放行"，这个星号是通配，不转义。
    const escaped = (toolName === 'execute_command' ? pattern : pattern.replace(/\*/g, '\\*'))
        .replace(/\\/g, '\\\\')
        .replace(/[?[\]{()}]/g, character => `\\${character}`)
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

    // allow 就是放行。重复出现同一次调用不再改回询问，否则自动执行形同失效。
    if (rules.decision === 'allow') return allow({ sessionId, messageId, toolCallId, toolName: name, input })

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

export default { check, decide, pending, remove, bind }
