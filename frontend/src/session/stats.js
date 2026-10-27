/*
会话统计：从消息里的请求用量算出上下文占用、累计 token 和耗时。
TopBar 和未来别的汇总面板共用这一份，避免两处各算一套。
调用示例：import { sessionStats } from './stats.js'
*/
export function sessionStats(session) {
  if (!session) return null
  const messages = session.messages || []
  const requests = messages.flatMap(message => message.requests?.length ? message.requests : message.request ? [message.request] : [])
  const sum = key => requests.reduce((total, item) => total + Number(item[key] || 0), 0)
  const last = requests.at(-1)
  const input = sum('input')
  const output = sum('output')
  const total = requests.reduce((value, item) => value + Number(item.total || 0), 0) || input + output
  const limit = Number(session.contextLimit || 0)
  const used = Number(last?.input || session.contextTokens || 0)
  if (!requests.length && !used && !limit) return null
  return {
    context: { used, limit, threshold: session.settings?.compactThreshold || 0.8 },
    usage: {
      input,
      output,
      cacheRead: sum('cache'),
      cacheWrite: sum('cacheWrite'),
      reasoning: sum('reasoning'),
      total,
      requests: requests.length,
      durationMs: requests.reduce((value, item) => value + Number(item.durationMs || 0), 0),
    },
  }
}
