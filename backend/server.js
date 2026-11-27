/*
路由表 + 启动：每条路由一行对应一个业务方法。用 Bun.serve 自带路由，不再引入 HTTP 框架。
推送通道是 GET SSE：连上先发 snapshot，再推 core / run / 扩展事件。send、compact、stop、configure 只走 POST。
扩展前端按名字打包后从这里发出去。
*/

import { Agents } from './features/Agents.js'
import { Stream } from './features/Stream.js'
import { Store } from './features/Store.js'
import { Models } from './features/Models.js'
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

async function frontend(name) {
    const code = await Loader.bundle(name)
    if (!code) return json({ error: `没有 ${name} 的前端入口` }, 404)
    const body = `const __agentVue__ = globalThis.__agentVue__;\n${code}`
    return new Response(body, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' } })
}

export function wire() {
    Agents.setup({ tools: () => Extension.paths() })
    Loader.hook({
        targets: { Agents, Stream, Store, Models, Extension, Loader },
        push: (id, event, data) => Stream.emit(id, event, data),
        tool: (path) => { for (const current of Agents.all()) if (!current.agent.tools.includes(path)) current.agent.tools = [...current.agent.tools, path] },
        untool: (path) => { for (const current of Agents.all()) current.agent.tools = current.agent.tools.filter(item => item !== path) },
    })
}

export function create(options = {}) {
    wire()
    return Bun.serve({
        port: options.port ?? (Number(process.env.PORT) || 3000),
        hostname: options.hostname ?? '127.0.0.1',
        // SSE 长连接空闲不发数据是常态（等事件），默认 10 秒 idleTimeout 会把它掐断并连累服务退出。
        idleTimeout: 255,                    // Bun 的单位是秒，255 是上限
        routes: {
            '/api/agent/:id/stream': request => stream(request.params.id, request).catch(fail),
            '/api/agent/:id/send': { POST: async request => { try { await Agents.send(request.params.id, await read(request)); return json({ ok: true }, 202) } catch (error) { return fail(error) } } },
            '/api/agent/:id/compact': { POST: async request => { try { await Agents.compact(request.params.id); return json({ ok: true }, 202) } catch (error) { return fail(error) } } },
            '/api/agent/:id/stop': { POST: async request => { try { return json(await Agents.stop(request.params.id)) } catch (error) { return fail(error) } } },
            '/api/agent/:id/configure': { POST: async request => { try { return json(await Agents.configure(request.params.id, await read(request))) } catch (error) { return fail(error) } } },
            '/api/extensions': () => json(Loader.entries()),
            '/api/extensions/inspect': () => json(Loader.inspect()),
            '/api/extensions/:name/frontend.js': request => frontend(request.params.name).catch(fail),
            '/api/op/:name': { POST: async request => { try { return json(await Extension.invoke(request.params.name, await read(request))) } catch (error) { return fail(error) } } },
        },
    })
}

if (import.meta.main) {
    wire()
    await Loader.start()
    const server = create()
    console.log(`agent backend ${server.url}`)
}
