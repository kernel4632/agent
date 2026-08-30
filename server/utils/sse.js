/*
 * SSE 实时反馈工具。
 *
 * 本文件集中处理连接、缓存、补发和心跳；业务指令只调用 connect/send/close。
 * 数据流：Agent 产生事件 → SSE 缓存并推送 → 浏览器收到反馈 → History 保存后 reset。
 *
目标被调用形式（绝对不可修改）：
// 连接
await SSE.connect({ id: sessionId, request })

// 发消息，随便发，不用管连接状态
await SSE.send({ id: sessionId, data: "你好" })
await SSE.send({ id: sessionId, data: "还在吗" })
await SSE.send({ id: sessionId, data: "任务完成了" })

// 断开
await SSE.close({ id: sessionId })

调用方全程只做三件事：连接、发、断。断线、缓存、补发、心跳，全是内部自动的。
 */

import { createResponse } from 'better-sse'

const HEARTBEAT_MS = 15000
const sessions = new Map()

// better-sse 默认会把字符串变成 JSON 字符串，例如 `"hello"`。
// 这里保留字符串原样发送，同时仍然把对象安全地转成 JSON。
const serialize = data => typeof data === 'string' ? data : JSON.stringify(data)

const sessionState = id => {
    let state = sessions.get(id)
    if (!state) {
        state = { nextId: 1, events: [], connection: null, controller: null }
        sessions.set(id, state)
    }
    return state
}

const remember = (state, data) => {
    const event = { id: state.nextId++, data }
    state.events.push(event)
    return event
}

const connect = async ({ id, request }) => {
    if (typeof id !== 'string' || !id) throw new TypeError('id must be a non-empty string')
    const state = sessionState(id)

    // 同一个会话只允许一个浏览器连接，新连接建立时关闭旧连接。
    // 这里只关闭网络，不清空事件，因为这可能只是客户端正在自动重连。
    if (state.controller) state.controller.abort()

    // better-sse 会监听 Request.signal。使用一个内部 signal 后，close()
    // 就可以通过 abort() 可靠地关闭它创建的 Fetch 流。
    const controller = new AbortController()
    state.controller = controller
    request?.signal?.addEventListener('abort', () => controller.abort(), { once: true })
    const sessionRequest = new Request(request, { signal: controller.signal })

    const response = createResponse(sessionRequest, {
        // 不主动发送 retry 字段，避免把连接配置和第一条业务事件拆成两次读取。
        // 浏览器仍会使用自己的默认重连时间。
        retry: null,
        keepAlive: HEARTBEAT_MS,
        serializer: serialize,
        headers: {
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
        },
    }, connection => {
        state.connection = connection

        // History 由前端通过 Session 接口读取；SSE 只补发尚未写入 History 的流式事件。
        connection.batch(buffer => {
            for (const event of state.events) buffer.push(event.data, undefined, String(event.id))
        })

        // 网络断开时保留缓存，等客户端重新连接后再补发。
        // 只有显式调用 close 才代表任务完成，才会清空缓存。
        connection.once('disconnected', () => {
            if (state.connection === connection) state.connection = null
            if (state.controller === controller) state.controller = null
        })
    })

    // better-sse 初始化时会先写一个空数据块。过滤它可以让调用方首次
    // reader.read() 直接读到真正的 SSE 事件，而不是读到空字符串。
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let pending = ''
    const body = response.body.pipeThrough(new TransformStream({
        transform(chunk, streamController) {
            pending += decoder.decode(chunk, { stream: true })
            const lines = pending.split('\n')
            pending = lines.pop()
            const output = lines
                .map(line => line.replace(/^(event|id|data|retry):(?=\S)/, '$1: '))
                .join('\n') + (lines.length ? '\n' : '')
            if (output) streamController.enqueue(encoder.encode(output))
        },
        flush(streamController) {
            pending += decoder.decode()
            const output = pending.replace(/^(event|id|data|retry):(?=\S)/gm, '$1: ')
            if (output) streamController.enqueue(encoder.encode(output))
        },
    }))
    return new Response(body, { status: response.status, headers: response.headers })
}

// 新任务开始时清空旧任务，当前任务产生的所有事件会一直保留。
// --- 清理已保存历史的事件 ---
const reset = async ({ id }) => {
    const state = sessionState(id)
    state.events = []
    state.nextId = 1
}

// --- 发送实时事件 ---
const send = async ({ id, data }) => {
    if (typeof id !== 'string' || !id) throw new TypeError('id must be a non-empty string')
    const state = sessionState(id)
    const event = remember(state, data)
    if (state.connection?.isConnected) {
        try {
            state.connection.push(event.data, undefined, String(event.id))
        } catch {
            // 连接可能在检查 isConnected 后立刻断开，缓存会在下次连接时补发。
        }
    }
}

// --- 关闭实时连接 ---
const close = async ({ id }) => {
    const state = sessions.get(id)
    if (!state) return
    if (state.controller) state.controller.abort()
    sessions.delete(id)
}

export default { connect, send, reset, close }
