/*
 * 会话统计：优先使用每次模型请求记下的真实用量；
 * 旧会话没有用量时，用消息正文和工具结果估算，并标记“估算”，不把 0 当成真实值。
 * TopBar 和别的汇总面板共用这一份，避免两处各算一套。
 * 调用示例：import { sessionStats } from './stats.js'
 */

// 中文、日文、韩文大约 1.5 个字符一个 token；英文和代码大约 3.6 个字符一个 token。
// 这是粗略换算，只用于旧会话，界面上必须带“估算”标记。
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/

export function estimateTokens(text) {
  if (text == null) return 0
  const value = typeof text === 'string' ? text : JSON.stringify(text)
  if (!value) return 0
  let cjk = 0
  let other = 0
  for (const char of value) {
    if (CJK.test(char)) cjk += 1
    else other += 1
  }
  return Math.ceil(cjk / 1.5 + other / 3.6)
}

// 系统提示词和工具定义同样占上下文；旧历史里没有它们，用一个固定值补上。
// 这个数字只影响估算，不会写进任何请求。
const SYSTEM_OVERHEAD = 4000

function messageUsage(message) {
  let input = 0
  let output = 0
  let reasoning = 0
  if (message.role === 'user') {
    input += estimateTokens(message.displayContent ?? message.content)
    return { input, output, reasoning }
  }

  const steps = Array.isArray(message.steps) ? message.steps : []
  const tools = message.tools || []
  if (steps.length) {
    let hasText = false
    for (const step of steps) {
      if (step.type === 'text' || step.type === 'reasoning') {
        output += estimateTokens(step.text)
        if (step.type === 'reasoning') reasoning += estimateTokens(step.text)
        if (step.type === 'text') hasText = true
      } else if (step.type === 'tool') {
        const tool = tools.find(item => item.id === step.toolId)
        if (!tool) continue
        output += estimateTokens(tool.input)
        input += estimateTokens(tool.output ?? tool.preview)
      }
    }
    // 旧格式可能只有正文、没有 text 步骤；补上，避免整段回答算成 0。
    if (!hasText) output += estimateTokens(message.content)
    return { input, output, reasoning }
  }

  output += estimateTokens(message.content)
  output += estimateTokens(message.reasoning)
  reasoning += estimateTokens(message.reasoning)
  for (const tool of tools) {
    output += estimateTokens(tool.input)
    input += estimateTokens(tool.output ?? tool.preview)
  }
  return { input, output, reasoning }
}

// 估算一次就缓存：流式输出时同一轮会反复触发统计，不能每个字都把整段历史重算一遍。
const estimateCache = new WeakMap()

function estimateSession(session, messages, limit) {
  const last = messages.at(-1)
  const signature = `${messages.length}:${last?.id || ''}`
  const cached = estimateCache.get(session)
  if (cached?.signature === signature) return cached.value

  let input = 0
  let output = 0
  let reasoning = 0
  let requests = 0
  let contextInput = 0
  let contextOutput = 0
  // 旧历史里压缩过的会话带 compact 标记。当前上下文只从最后一次压缩之后算，
  // 不能把已经压缩掉的几十万字再算进 128K 窗口里。
  const lastCompact = messages.findLastIndex(message => message.compact === true)
  const contextStart = lastCompact < 0 ? 0 : lastCompact
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    const usage = messageUsage(message)
    input += usage.input
    output += usage.output
    reasoning += usage.reasoning
    if (index >= contextStart) {
      contextInput += usage.input
      contextOutput += usage.output
    }
    if (message.role === 'assistant' && (message.content || message.steps?.length || message.tools?.length)) requests += 1
  }
  const used = SYSTEM_OVERHEAD + contextInput + contextOutput
  const value = {
    contextUsed: used,
    input,
    output,
    reasoning,
    requests,
    total: input + output,
    // 超过上限时仍然记住真实估算值，面板可以显示“已超出”而不是假装刚好满。
    over: Boolean(limit && used > limit),
  }
  estimateCache.set(session, { signature, value })
  return value
}

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
  const exactUsed = Number(last?.input || session.contextTokens || 0)
  // 只有缺少真实用量时才遍历消息做估算，正常会话加载不必多算一遍。
  const estimate = (!exactUsed || !requests.length) && messages.length ? estimateSession(session, messages, limit) : null
  // 有最后一次请求的真实输入 token 就用真实的；旧会话没有记录时退回估算。
  const usedApproximate = !exactUsed && Boolean(estimate)
  const used = exactUsed || estimate?.contextUsed || 0
  const usageApproximate = !requests.length && Boolean(estimate)
  // 空会话没有内容可统计，顶栏不显示一个 0% 的空圆环；发出第一条消息后再出现。
  if (!messages.length && !requests.length && !session.contextTokens) return null
  return {
    approximate: usedApproximate || usageApproximate,
    context: {
      used,
      limit,
      threshold: session.settings?.compactThreshold || 0.8,
      approximate: usedApproximate,
      over: Boolean(limit && used > limit),
    },
    usage: {
      input: usageApproximate ? estimate.input : input,
      output: usageApproximate ? estimate.output : output,
      cacheRead: usageApproximate ? 0 : sum('cache'),
      cacheWrite: usageApproximate ? 0 : sum('cacheWrite'),
      reasoning: usageApproximate ? estimate.reasoning : sum('reasoning'),
      total: usageApproximate ? estimate.total : total,
      requests: usageApproximate ? estimate.requests : requests.length,
      messages: messages.length,
      durationMs: usageApproximate ? 0 : requests.reduce((value, item) => value + Number(item.durationMs || 0), 0),
      approximate: usageApproximate,
    },
    // 真实请求最多保留最近 18 次，用来画每轮消耗的小柱图；估算会话没有这项。
    series: requests.slice(-18).map(item => ({ input: Number(item.input || 0), output: Number(item.output || 0) })),
  }
}
