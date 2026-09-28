export async function readSSE(response, receiveEvent) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `事件订阅失败 (${response.status})`)
  }
  if (!response.body) throw new Error('服务器没有返回事件流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      let boundary
      while ((boundary = /\r?\n\r?\n/.exec(pending))) {
        const frame = pending.slice(0, boundary.index)
        pending = pending.slice(boundary.index + boundary[0].length)
        const lines = frame.split(/\r?\n/)
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n')
        if (!data || data === '[DONE]') continue
        const id = Number(lines.find(line => line.startsWith('id:'))?.slice(3).trim() || 0)
        await receiveEvent({ ...JSON.parse(data), eventID: id })
      }
      if (done) return
    }
  } finally { reader.releaseLock() }
}
