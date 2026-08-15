/* ask 规则会一直等用户决定；allow always 会追加一条持久规则。 */
import picomatch from 'picomatch'
import Store from '../store.js'
import Plugin from './plugin.js'

const request = async (sessionID, callID, tool, input) => {
    const serializedInput = JSON.stringify(input)
    const rule = Store.config.permission.findLast(item => {
        const toolMatches = item.tool === '*' || picomatch.isMatch(tool, item.tool)
        const inputMatches = item.match === '*'
            || item.match === serializedInput
            || picomatch.isMatch(serializedInput, item.match, { dot: true })
        return toolMatches && inputMatches
    })
    if (rule?.action === 'allow') return true

    const runtime = Store.runtimes[sessionID]
    const signal = runtime.abortController.signal
    if (signal.aborted) return false

    // 先通知客户端，再等待 permission.decide 写入结果。
    const detail = await Plugin.emit('permission.request', { sessionID, callID, tool, input })
    await Store.broadcast(sessionID, { type: 'data-permission', data: detail })

    const decision = await new Promise(resolve => {
        runtime.permission.set(callID, resolve)
        const deny = () => resolve({ action: 'deny', scope: 'once' })
        if (signal.aborted) deny()
        else signal.addEventListener('abort', deny, { once: true })
    }).finally(() => runtime.permission.delete(callID))

    if (decision.action === 'allow' && decision.scope === 'always') {
        Store.config.permission = [...Store.config.permission, { tool, match: serializedInput, action: 'allow' }]
        await Store.save('config')
    }
    return decision.action === 'allow'
}

const decide = async (sessionID, callID, action, scope) => {
    const resolve = Store.runtimes[sessionID]?.permission.get(callID)
    if (!resolve || !['allow', 'deny'].includes(action) || !['once', 'always'].includes(scope)) return false

    // 决定先唤醒等待者，再广播给所有客户端。
    resolve({ action, scope })
    await Store.broadcast(sessionID, { type: 'data-permission-resolved', data: { callID, action, scope } })
    return true
}

export default { request, decide }
