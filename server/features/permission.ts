/*
工具权限：按传入规则匹配工具名与参数，未直接允许的调用会等待外部决定。
等待、事件、插件处理和规则持久化均由调用方注入，本模块不读取运行时或配置。
*/
import picomatch from 'picomatch'
import type { PermissionDecision, PermissionRule } from '../types.ts'
import type { UIMessageChunk } from 'ai'
import Abort from '../utils/abort.ts'

const request = async ({ callID, tool, input, rules }: {
    callID: string
    tool: string
    input: unknown
    rules: PermissionRule[]
}, {
    signal,
    receive,
    inspect,
    wait,
    persist,
}: {
    signal: AbortSignal
    receive?: (event: UIMessageChunk) => void | Promise<void>
    inspect?: (request: { callID: string; tool: string; input: unknown }) => unknown | Promise<unknown>
    wait: (resolve: (decision: PermissionDecision) => void) => void | (() => void)
    persist?: (rule: PermissionRule) => unknown | Promise<unknown>
}) => {
    const rule = rules.findLast(rule => {
        const toolMatches = rule.tool === '*' || picomatch.isMatch(tool, rule.tool)
        const inputMatches = rule.match === '*' || picomatch.isMatch(JSON.stringify(input), rule.match, { dot: true })
        return toolMatches && inputMatches
    })
    if (rule?.action === 'allow') return true

    const request = inspect
        ? await Abort.race(Promise.resolve(inspect({ callID, tool, input })), signal)
        : { callID, tool, input }
    let remove: void | (() => void)
    const pending = new Promise<PermissionDecision>(resolve => { remove = wait(resolve) })
    const decision = await (async () => {
        await receive?.({ type: 'data-permission-request', data: request, transient: true })
        return Abort.race(pending, signal)
    })().finally(() => remove?.())

    if (decision.action === 'allow' && decision.scope === 'always') {
        await persist?.(decision.rule ?? { tool, match: JSON.stringify(input), action: 'allow' })
    }
    return decision.action === 'allow'
}

const decide = async (resolve: ((decision: PermissionDecision) => void) | undefined, callID: string, decision: PermissionDecision, receive?: (event: UIMessageChunk) => void | Promise<void>) => {
    if (!resolve) return false
    await receive?.({ type: 'data-permission-resolve', data: { callID, decision }, transient: true })
    resolve(decision)
    return true
}

export default { request, decide }
