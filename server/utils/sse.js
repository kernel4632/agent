/*
 * SSE 实时反馈：把 Agent 运行过程推给前端，断线重连后补发。
 *
 * 这里直接管理服务端的 ReadableStream，不依赖第三方 SSE 适配器的延迟初始化。
 * 连接在初始化前被取消、被新连接替换、或 close() 关闭时，只关闭自己这一条流；
 * 不会向已关闭的流写入，也不会留下未处理的 Promise rejection。
 *
 * 调用示例：
 *   await SSE.connect({ id: sessionId, request })
 *   await SSE.send({ id: sessionId, data: { type: 'text-delta', text: '你' } })
 *   await SSE.reset({ id: sessionId })   // 历史已保存，清掉已经落盘的流式事件
 *   await SSE.close({ id: sessionId })   // 会话结束，断开并释放缓存
 */

const HEARTBEAT_MS = 15000
const encoder = new TextEncoder()
const sessions = new Map()

// better-sse 会把字符串变成 JSON 字符串；这里保留字符串原样，同时把对象转成 JSON。
const serialize = data => typeof data === 'string' ? data : JSON.stringify(data)

// --- 一条 SSE 事件的文本；多行字符串要逐行加 data: ---
const eventText = (id, data) => {
    const body = String(serialize(data)).split('\n').map(line => `data: ${line}`).join('\n')
    return `id: ${id}\n${body}\n\n`
}

const sessionState = id => {
    let state = sessions.get(id)
    if (!state) {
        state = { nextId: 1, events: [], connection: null, controller: null }
        sessions.set(id, state)
    }
    return state
}

// --- 建立实时连接 ---
const connect = async ({ id, request }) => {
    const state = sessionState(id)

    // 同一个会话只允许一个连接；新连接替换旧连接，但保留事件缓存供新连接补发。
    if (state.controller) state.controller.abort()

    const controller = new AbortController()
    state.controller = controller
    const abortFromRequest = () => controller.abort()
    request?.signal?.addEventListener('abort', abortFromRequest, { once: true })
    if (request?.signal?.aborted) controller.abort()

    let stream = null
    let closed = false
    let heartbeat = null

    // 关闭连接：只关自己，不碰后来替换上来的连接。
    const shutdown = () => {
        if (closed) return
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        controller.abort()
        request?.signal?.removeEventListener('abort', abortFromRequest)
        if (state.connection === connection) state.connection = null
        if (state.controller === controller) state.controller = null
        try { stream?.close() } catch {}
    }

    const connection = {
        get isConnected() { return !closed },
        push(data, eventId) {
            if (closed || !stream) return
            try {
                stream.enqueue(encoder.encode(eventText(eventId, data)))
            } catch {
                shutdown()
            }
        },
        close: shutdown,
    }

    controller.signal.addEventListener('abort', shutdown, { once: true })

    const body = new ReadableStream({
        start(controllerStream) {
            stream = controllerStream
            if (closed) {
                try { stream.close() } catch {}
                return
            }
            if (controller.signal.aborted) {
                shutdown()
                try { stream.close() } catch {}
                return
            }

            state.connection = connection
            for (const event of state.events) connection.push(event.data, event.id)

            if (closed) return
            heartbeat = setInterval(() => {
                if (closed) return
                try { stream.enqueue(encoder.encode(': keep-alive\n\n')) } catch { shutdown() }
            }, HEARTBEAT_MS)
            heartbeat.unref?.()
        },
        cancel() {
            shutdown()
        },
    })

    return new Response(body, {
        status: 200,
        headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
        },
    })
}

// --- 清掉已经落盘的事件 ---
const reset = async ({ id }) => {
    const state = sessionState(id)
    state.events = []
    state.nextId = 1
}

// --- 发送实时事件 ---
const send = async ({ id, data }) => {
    const state = sessionState(id)
    const event = { id: state.nextId++, data }
    state.events.push(event)
    if (state.connection?.isConnected) state.connection.push(event.data, event.id)
}

// --- 关闭实时连接 ---
const close = async ({ id }) => {
    const state = sessions.get(id)
    if (!state) return
    if (state.controller) state.controller.abort()
    sessions.delete(id)
}

export default { connect, send, reset, close }
