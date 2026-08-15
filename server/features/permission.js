/* ask 规则会一直等用户决定；allow always 会追加一条持久规则。 */
import picomatch from 'picomatch' // 使用成熟 glob 匹配工具名和输入。
import Store from '../store.js' // 读取规则并保存永久允许项。
import Plugin from './plugin.js' // 允许插件补充审批展示信息。

const request = async (sessionID, callID, tool, input) => {
    const serializedInput = JSON.stringify(input) // 规则匹配使用稳定的完整输入文本。
    const rule = Store.config.permission.findLast(item => {
        const toolMatches = item.tool === '*' || picomatch.isMatch(tool, item.tool) // 先匹配工具名。
        const inputMatches = item.match === '*'
            || item.match === serializedInput
            || picomatch.isMatch(serializedInput, item.match, { dot: true })
        return toolMatches && inputMatches // 工具和输入必须同时命中。
    })
    if (rule?.action === 'allow') return true // 已允许的调用不打断 Agent。

    const runtime = Store.runtimes[sessionID] // 审批等待保存在会话运行态。
    const signal = runtime.abortController.signal // stop 会通过此信号拒绝等待。
    if (signal.aborted) return false // 已停止的会话不再弹审批。

    // 先通知客户端，再等待 permission.decide 写入结果。
    const detail = await Plugin.emit('permission.request', { sessionID, callID, tool, input }) // 生成展示数据。
    await Store.broadcast(sessionID, { type: 'data-permission', data: detail }) // 通知所有在线页面。

    const decision = await new Promise(resolve => {
        runtime.permission.set(callID, resolve) // decide 通过 callID 唤醒此 Promise。
        const deny = () => resolve({ action: 'deny', scope: 'once' }) // 停止时默认拒绝一次。
        if (signal.aborted) deny() // 处理监听前已经停止的窗口。
        else signal.addEventListener('abort', deny, { once: true }) // 后续停止也释放等待。
    }).finally(() => runtime.permission.delete(callID))

    if (decision.action === 'allow' && decision.scope === 'always') {
        // 追加精确匹配规则，让同样的调用下次无需再次审批。
        Store.config.permission = [...Store.config.permission, { tool, match: serializedInput, action: 'allow' }]
        await Store.save('config') // 永久允许跨重启生效。
    }
    return decision.action === 'allow' // 工具层只关心本次能否执行。
}

const decide = async (sessionID, callID, action, scope) => {
    const resolve = Store.runtimes[sessionID]?.permission.get(callID) // 找到对应等待者。
    if (!resolve || !['allow', 'deny'].includes(action) || !['once', 'always'].includes(scope)) return false // 拒绝无效决定。

    // 决定先唤醒等待者，再广播给所有客户端。
    resolve({ action, scope }) // 让工具调用继续或结束。
    await Store.broadcast(sessionID, { type: 'data-permission-resolved', data: { callID, action, scope } })
    return true // 告知页面决定已经被接收。
}

export default { request, decide } // 暴露审批等待和决定入口。
