/*
 * 子进程回归夹具：在独立进程里演练 SSE 的三种断开方式。
 * 测试通过退出码判断有没有未处理异常导致进程退出。
 */
import SSE from '../utils/sse.js'

const mode = process.argv[2]
const id = `exit-${mode}`
const controller = new AbortController()

if (mode === 'abort') {
    await SSE.connect({ id, request: new Request('http://localhost/sse', { signal: controller.signal }) })
    controller.abort()
} else if (mode === 'close') {
    await SSE.connect({ id, request: new Request('http://localhost/sse') })
    await SSE.close({ id })
} else if (mode === 'replace') {
    await SSE.connect({ id, request: new Request('http://localhost/sse') })
    await SSE.connect({ id, request: new Request('http://localhost/sse') })
} else {
    throw new Error(`unknown mode: ${mode}`)
}

await Bun.sleep(30)
