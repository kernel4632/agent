/*
路由表 + 启动：每条路由一行对应一个业务方法。用 Bun.serve 自带路由，不再引入 HTTP 框架。
推送通道是 GET SSE：连上先发 snapshot，再推 core / run / 扩展事件。send、compact、stop、configure 只走 POST。
*/

import { Agents } from './features/Agents.js'
import { Stream } from './features/Stream.js'
import { Extension } from './features/Extension.js'
import { Loader } from './features/Loader.js'

const encoder = new TextEncoder()

function json(data, status = 200) {
    return Response.json(data, { status })
}

function fail(error) {
    return json({ error: error.message ?? String(error) }, error.status ?? 500)
}

async function read(request) {
    try { return await request.json() } catch { return {} }
}

function frame(name, data) {
    return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
}

// 一条长连接：先 open（可能读盘），再同步登记订阅并发快照，之后只推实时事件。
async function stream(id, request) {
    await Agents.open(id)
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const send = (name, data) => writer.write(frame(name, data)).catch(() => {})
    const unsubscribe = Stream.subscribe(id, send)
    send('snapshot', Agents.snapshot(id))
    const close = () => { unsubscribe(); writer.close().catch(() => {}) }
    request.signal.addEventListener('abort', close, { once: true })
    return new Response(readable, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' } })
}

export function create(options = {}) {
    return Bun.serve({
        port: options.port ?? (Number(process.env.PORT) || 3000),
        hostname: options.hostname ?? '127.0.0.1',
        routes: {
            '/api/agent/:id/stream': request => stream(request.params.id, request).catch(fail),
            '/api/agent/:id/send': { POST: async request => { try { await Agents.send(request.params.id, await read(request)); return json({ ok: true }, 202) } catch (error) { return fail(error) } } },
            '/api/agent/:id/compact': { POST: async request => { try { await Agents.compact(request.params.id); return json({ ok: true }, 202) } catch (error) { return fail(error) } } },
            '/api/agent/:id/stop': { POST: async request => { try { return json(await Agents.stop(request.params.id)) } catch (error) { return fail(error) } } },
            '/api/agent/:id/configure': { POST: async request => { try { return json(await Agents.configure(request.params.id, await read(request))) } catch (error) { return fail(error) } } },
            '/api/extensions': () => json(Loader.entries()),
            '/api/op/:name': { POST: async request => { try { return json(await Extension.invoke(request.params.name, await read(request))) } catch (error) { return fail(error) } } },
        },
    })
}

if (import.meta.main) {
    await Loader.start()
    const server = create()
    console.log(`agent backend ${server.url}`)
}
