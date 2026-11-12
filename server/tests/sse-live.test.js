/*
 * SSE 生命周期快照：History.save 会清普通事件缓存，但正在运行的
 * agent-start / llm-start 还没有写进 history，必须留给重连补发。
 */
import { test, expect } from 'bun:test'
import SSE from '../utils/sse.js'

const readUntil = async (response, pattern, timeout = 2000) => {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  const deadline = Date.now() + timeout
  try {
    while (Date.now() < deadline) {
      const { done, value } = await Promise.race([
        reader.read(),
        Bun.sleep(Math.max(1, deadline - Date.now())).then(() => ({ done: true })),
      ])
      if (done) break
      text += decoder.decode(value, { stream: true })
      if (pattern.test(text)) return text
    }
    return text
  } finally {
    await reader.cancel().catch(() => {})
  }
}

test('reset 后新连接仍能收到正在进行的 llm-start', async () => {
  const id = `sse-live-${crypto.randomUUID()}`
  try {
    await SSE.send({ id, data: { type: 'agent-start' } })
    await SSE.send({ id, data: { type: 'llm-start', requestId: 'request-1', model: 'test' } })
    await SSE.reset({ id })

    const response = await SSE.connect({ id, request: new Request('http://localhost/sse') })
    const text = await readUntil(response, /llm-start/)

    expect(text).toContain('"type":"agent-start"')
    expect(text).toContain('"type":"llm-start"')
    expect(text).toContain('"requestId":"request-1"')
  } finally {
    await SSE.close({ id })
  }
})

test('agent-finish 后 reset 不再重放上一轮请求', async () => {
  const id = `sse-live-${crypto.randomUUID()}`
  try {
    await SSE.send({ id, data: { type: 'agent-start' } })
    await SSE.send({ id, data: { type: 'llm-start', requestId: 'request-old' } })
    await SSE.send({ id, data: { type: 'agent-finish' } })
    await SSE.reset({ id })

    const response = await SSE.connect({ id, request: new Request('http://localhost/sse') })
    const text = await readUntil(response, /llm-start/, 300)
    expect(text).not.toContain('"type":"llm-start"')
  } finally {
    await SSE.close({ id })
  }
})
