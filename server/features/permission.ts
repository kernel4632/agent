/*
工具权限：按配置顺序匹配工具名与参数，未直接允许的调用会无限等待用户决定。
永久允许只是追加一条更具体的 allow 规则，不提供永久拒绝。
*/
import picomatch from 'picomatch'
import Store from '../store.ts'
import Plugin from './plugin.ts'
import type { PermissionDecision, PermissionRule } from '../types.ts'
import type { UIMessageChunk } from 'ai'
import Config from '../commands/config.ts'

const request = async (sessionID: string, callID: string, tool: string, input: unknown, onEvent?: (event: UIMessageChunk) => void | Promise<void>) => {
    const rule = Store.config.permission.findLast(rule => {
        const toolMatches = rule.tool === '*' || picomatch.isMatch(tool, rule.tool)
        const inputMatches = rule.match === '*' || picomatch.isMatch(JSON.stringify(input), rule.match, { dot: true })
        return toolMatches && inputMatches
    })
    if (rule?.action === 'allow') return true

    const request = await Plugin.emit('permission.request', { sessionID, callID, tool, input })
    const signal = Store.runtimes[sessionID]!.abort.signal
    signal.throwIfAborted()
    await onEvent?.({ type: 'data-permission-request', data: request, transient: true })
    const decision = await new Promise<PermissionDecision>((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
        signal.addEventListener('abort', abort, { once: true })
        Store.runtimes[sessionID]!.permission.set(callID, decision => {
            signal.removeEventListener('abort', abort)
            resolve(decision)
        })
    }).finally(() => Store.runtimes[sessionID]!.permission.delete(callID))

    if (decision.action === 'allow' && decision.scope === 'always') {
        await Config.save({ permission: [...Store.config.permission, decision.rule ?? { tool, match: JSON.stringify(input), action: 'allow' }] })
    }
    return decision.action === 'allow'
}

const decide = (sessionID: string, callID: string, decision: PermissionDecision, onEvent?: (event: UIMessageChunk) => void | Promise<void>) => {
    const resolve = Store.runtimes[sessionID]?.permission.get(callID)
    if (!resolve) return false
    resolve(decision)
    void onEvent?.({ type: 'data-permission-resolve', data: { callID, decision }, transient: true })
    return true
}

export default { request, decide }
