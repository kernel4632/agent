/* 压缩只追加摘要消息，原始历史始终保留。 */
import Store from '../store.js' // 读取会话并保存摘要消息。
import LLM from '../utils/llm.js' // 使用会话模型生成摘要。
import Context from './context.js' // 复用正常模型上下文选择规则。
import Plugin from './plugin.js' // 通知插件摘要已经追加。

const run = async sessionID => {
    const session = Store.sessions[sessionID] // 摘要追加到这条会话历史。
    const runtime = Store.runtimes[sessionID] // 手动压缩独占会话运行态。
    if (runtime.status === 'running') throw new Error('Cannot compact a running session') // 避免与 Agent 并写历史。

    const provider = Store.config.providers.find(item => item.name === session.provider) // 定位提供商。
    const model = provider?.models.find(item => item.id === session.model) // 定位摘要使用的模型。
    if (!provider || !model) throw new Error('Session model is not configured') // 缺配置时立即失败。

    runtime.status = 'running' // SSE 页面显示压缩正在进行。
    runtime.abortController = new AbortController() // stop 可以取消这次摘要请求。
    const signal = runtime.abortController.signal // 保存压缩自己的运行身份。

    try {
        await Store.broadcast(sessionID, { type: 'data-status', data: { status: 'running' } })
        const context = await Context.build(sessionID) // 只摘要模型当前可见的历史。
        const result = await LLM.stream({
            provider,
            model,
            messages: context.messages,
            tools: context.tools,
            instructions: Store.config.prompts.summary,
            signal,
        })
        const summary = { ...result.message, summary: true, usage: result.usage } // 标记为上下文锚点。
        session.messages.push(summary) // 原消息保留，摘要只追加。
        await Store.save(sessionID) // 先持久化再通知外部。
        await Plugin.emit('message.append', { sessionID, message: summary }) // 让插件观察摘要消息。
        await Store.broadcast(sessionID, { type: 'data-compact', data: { message: summary } })
        return summary // 手动调用方可直接展示生成结果。
    } finally {
        if (Store.runtimes[sessionID] === runtime && runtime.abortController.signal === signal) {
            runtime.status = 'idle' // 旧压缩不能结束后来启动的 Agent。
            await Store.broadcast(sessionID, { type: 'data-status', data: { status: 'idle', reason: 'compact' } })
        }
    }
}

export default { run } // 暴露手动压缩入口。
