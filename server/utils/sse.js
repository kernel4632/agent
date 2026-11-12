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
 *   await SSE.reset({ id: sessionId })   // 历史已保存，清掉已经写入历史的流式事件
 *   await SSE.close({ id: sessionId })   // 会话结束，断开并释放缓存
 *
 * 除普通事件缓存外，还单独保存“当前仍在进行”的生命周期事件：
 * agent-start / llm-start / retry / compact-start。History.save() 会清掉普通事件，
 * 但这些事件还没有写进 history，新连接必须还能拿到，否则刷新/重连后会看不到
 * 正在请求、正在重试或正在压缩。它们只保留最新一份，开销很小。
 */

// Bun/Elysia 的空闲连接会在几秒内被关掉；心跳必须比它短，否则安静等待模型时
// 实时连接会被当成空闲连接清掉，下一批事件只能在页面刷新后从历史里补。
const HEARTBEAT_MS = 3000
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
        state = { nextId: 1, events: [], live: new Map(), connections: new Set() }
        sessions.set(id, state)
    }
    return state
}

// --- 记录/清除当前仍在进行的生命周期事件 ---
// 这些事件描述的是“后端此刻正在做什么”，不是已经写进 history 的消息；
// History.save 清缓存时必须留下，否则刷新后就只能看到一条用户消息。
const rememberLive = (state, event) => {
    const type = event.data?.type
    if (type === 'agent-start' || type === 'agent-resume') {
        state.live.clear()
        state.live.set('agent', event)
        return
    }
    if (type === 'agent-finish') {
        state.live.clear()
        return
    }
    if (type === 'llm-start') {
        state.live.delete('retry')
        state.live.delete('request-finish')
        state.live.set('request-start', event)
        return
    }
    if (type === 'llm-finish') {
        state.live.set('request-finish', event)
        return
    }
    if (type === 'retry') {
        state.live.set('retry', event)
        return
    }
    if (type === 'compact-start') {
        state.live.delete('compact-finish')
        state.live.set('compact-start', event)
        return
    }
    if (type === 'compact-finish') {
        state.live.set('compact-finish', event)
    }
}

// --- 建立实时连接 ---
// 同一个会话可以同时有多个订阅者（多个标签页/窗口）；每个连接独立重放缓存、
// 独立心跳、独立断开，不能让新连接把旧连接踢掉。
const connect = async ({ id, request }) => {
    const state = sessionState(id)

    const controller = new AbortController()
    const abortFromRequest = () => controller.abort()
    request?.signal?.addEventListener('abort', abortFromRequest, { once: true })
    if (request?.signal?.aborted) controller.abort()

    let stream = null
    let closed = false
    let heartbeat = null

    // 关闭这个连接：只处理自己，不碰同会话的其他订阅者。
    const shutdown = () => {
        if (closed) return
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        controller.abort()
        request?.signal?.removeEventListener('abort', abortFromRequest)
        state.connections.delete(connection)
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
        controller,
    }
    state.connections.add(connection)

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

            const replayed = new Set()
            for (const event of state.events) {
                connection.push(event.data, event.id)
                replayed.add(event.id)
            }
            // reset 之后普通事件已经没了，但正在跑的生命周期事件还必须补发。
            // 按事件 id 排序，保持 llm-start 在 llm-finish 之前。
            for (const event of [...state.live.values()].sort((a, b) => a.id - b.id)) {
                if (replayed.has(event.id)) continue
                connection.push(event.data, event.id)
            }

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

// --- 清掉已经写进历史的事件；正在进行的生命周期事件继续保留 ---
const reset = async ({ id }) => {
    const state = sessionState(id)
    state.events = []
    // nextId 不归零：保留的生命周期事件还带着原来的 id，重放时不能和后续事件撞号。
}

// --- 发送实时事件 ---
const send = async ({ id, data }) => {
    const state = sessionState(id)
    const event = { id: state.nextId++, data }
    state.events.push(event)
    rememberLive(state, event)
    for (const connection of state.connections) {
        if (connection.isConnected) connection.push(event.data, event.id)
    }
}

// --- 关闭会话的全部实时连接 ---
const close = async ({ id }) => {
    const state = sessions.get(id)
    if (!state) return
    for (const connection of [...state.connections]) connection.close()
    sessions.delete(id)
}

export default { connect, send, reset, close }
