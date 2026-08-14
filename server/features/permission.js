/* ask 规则会一直等用户决定；allow always 会追加一条持久规则。 */
import picomatch from 'picomatch'
import Store from '../store.js'
import Plugin from './plugin.js'

const request = async (sessionID, callID, tool, input) => {
    const rule = Store.config.permission.findLast(item =>
        (item.tool === '*' || picomatch.isMatch(tool, item.tool)) &&
        (item.match === '*' || item.match === JSON.stringify(input) || picomatch.isMatch(JSON.stringify(input), item.match, { dot: true })))
    if (rule?.action === 'allow') return true
    const runtime = Store.runtimes[sessionID]
    const signal = runtime.abortController.signal
    if (signal.aborted) return false
    const detail = await Plugin.emit('permission.request', { sessionID, callID, tool, input })
    await Store.broadcast(sessionID, { type: 'data-permission', data: detail })
    const decision = await new Promise(resolve => {
        runtime.permission.set(callID, resolve)
        const deny = () => resolve({ action: 'deny', scope: 'once' })
        if (signal.aborted) deny()
        else signal.addEventListener('abort', deny, { once: true })
    }).finally(() => runtime.permission.delete(callID))
    if (decision.action === 'allow' && decision.scope === 'always') {
        Store.config.permission = [...Store.config.permission, { tool, match: JSON.stringify(input), action: 'allow' }]
        await Store.save('config')
    }
    return decision.action === 'allow'
}
const decide = async (sessionID, callID, action, scope) => {
    const resolve = Store.runtimes[sessionID]?.permission.get(callID)
    if (!resolve || !['allow', 'deny'].includes(action) || !['once', 'always'].includes(scope)) return false
    resolve({ action, scope })
    await Store.broadcast(sessionID, { type: 'data-permission-resolved', data: { callID, action, scope } })
    return true
}

export default { request, decide }
