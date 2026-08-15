/* Agent 只有两个动作：发送用户消息，或停止当前循环。 */
import { nanoid } from 'nanoid' // 为字符串输入补齐 UI 消息 ID。
import Store from '../store.js' // 读取会话运行态并广播结果。
import Loop from '../features/loop.js' // 启动唯一的模型与工具循环。
import Plugin from '../features/plugin.js' // 通知插件用户消息已经写入。
import Session from './session.js' // 复用消息追加和落盘动作。

const stop = sessionID => {
    const runtime = Store.runtimes[sessionID] // 取得这条会话正在使用的控制器。
    if (!runtime) return false // 已删除的会话无需再停止。
    const running = runtime.status !== 'idle' // 保留调用前的状态作为返回值。

    runtime.abortController.abort() // 通知模型、审批和工具尽快结束。
    runtime.processes.forEach(process => process.kill()) // 同时终止 shell 等子进程。
    runtime.processes.clear() // 不让下一次运行复用旧进程引用。
    return running // 让 HTTP 层知道本次是否真的停止了工作。
}

const send = async (sessionID, input) => {
    const message = typeof input === 'string' // 字符串输入转换为标准 UI 消息。
        ? { id: nanoid(), role: 'user', parts: [{ type: 'text', text: input }] }
        : input

    stop(sessionID) // 新消息始终取代上一轮尚未结束的工作。
    const runtime = Store.runtimes[sessionID] // 复用会话的 SSE 与进程集合。
    runtime.status = 'running' // 让新连接知道会话已经开始处理。
    runtime.abortController = new AbortController() // 为本轮工作建立独立取消身份。
    runtime.events = [] // 不向新轮次重放上一轮的流式碎片。
    const signal = runtime.abortController.signal // 保存身份，防止旧调用复活。
    try {
        await Session.append(sessionID, message) // 先持久化用户意图，再请求模型。
    } catch (error) {
        if (runtime.abortController.signal === signal) runtime.status = 'idle' // 仅归还自己的运行态。
        throw error // 让 HTTP 路由报告消息没有写入成功。
    }
    if (signal.aborted || runtime.abortController.signal !== signal) return message // 较新的 send 已接管本轮。

    void Plugin.emit('message.append', {
        sessionID, message, signal, // 插件可读取本轮取消信号。
    }).then(() => signal.aborted ? undefined : Loop.run(sessionID)).catch(async error => {
        if (Store.runtimes[sessionID] !== runtime || runtime.abortController.signal !== signal) return // 不干扰后来运行。

        runtime.status = 'idle' // 插件失败时归还本轮运行态。
        await Store.broadcast(sessionID, { type: 'error', errorText: String(error) }) // 把失败原因送给页面。
        await Store.broadcast(sessionID, { type: 'data-status', data: { status: 'idle', reason: 'error' } }) // 结束 SSE。
    })

    return message // HTTP 请求只确认接收，循环在后台继续。
}

export default { send, stop } // Agent 的公开入口只保留发送和停止。
