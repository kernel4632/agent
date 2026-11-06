/*
 * 会话统计：优先使用每次模型请求记下的真实用量；
 * 旧会话没有用量时，用消息正文和工具结果估算，并标记“估算”，不把 0 当成真实值。
 * 输入框下方的状态栏和详细面板共用这一份，避免两处各算一套。
 * 调用示例：import { sessionStats } from '../features/stats.js'
 */

import { store } from '../store.js' // 压缩阈值来自当前全局配置

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

// 请求行只在新增消息或结束一次请求时变化；正文增量不该重新摊平整段历史。
const requestSummaryCache = new WeakMap()

function requestSummary(session, messages) {
  const last = messages.at(-1)
  const lastRequest = last?.requests?.at(-1) || last?.request || null
  const signature = [
    messages.length,
    last?.id || '',
    last?.requests?.length || 0,
    lastRequest?.status || '',
    lastRequest?.input || 0,
    lastRequest?.output || 0,
    lastRequest?.finishedAt || 0,
  ].join(':')
  const cached = requestSummaryCache.get(session)
  if (cached?.signature === signature) return cached
  const requests = messages.flatMap(message => message.requests?.length ? message.requests : message.request ? [message.request] : [])
  const request = messages.filter(message => !message.compact).flatMap(message => message.requests?.length ? message.requests : message.request ? [message.request] : []).at(-1)
  const value = { signature, requests, last: request }
  requestSummaryCache.set(session, value)
  return value
}

// 内容构成按消息缓存：流式时只有正在增长的最后一条会失效，历史消息不重复估算。
const messageCompositionCache = new WeakMap()

const valueLength = value => {
  if (value == null) return 0
  if (typeof value === 'string') return value.length
  if (typeof value.value === 'string') return value.value.length
  return 1
}

function compositionOf(message) {
  const steps = Array.isArray(message.steps) ? message.steps : []
  const messageTools = message.tools || []
  // 内容构成是面板里的估算值，不需要每个 token 更新；流式结束或结构变化时再重算。
  const signature = [
    message.role,
    message.compact ? 1 : 0,
    message.isStreaming ? 1 : 0,
    steps.length,
    steps.map(step => step.type).join(','),
    messageTools.length,
    messageTools.map(tool => `${tool.id}:${tool.status}`).join(','),
  ].join('|')
  const cached = messageCompositionCache.get(message)
  if (cached?.signature === signature) return cached.value

  let user = 0
  let thinking = 0
  let reply = 0
  let tools = 0
  if (message.role === 'user') {
    user = estimateTokens(message.displayContent ?? message.content)
  } else if (message.role === 'assistant') {
    if (steps.length) {
      let hasText = false
      for (const step of steps) {
        if (step.type === 'reasoning') thinking += estimateTokens(step.text)
        else if (step.type === 'text') {
          reply += estimateTokens(step.text)
          hasText = true
        }
      }
      if (!hasText) reply += estimateTokens(message.content)
    } else {
      thinking += estimateTokens(message.reasoning)
      reply += estimateTokens(message.content)
    }
    for (const tool of messageTools) tools += estimateTokens(tool.output ?? tool.preview)
  }

  const value = { user, thinking, reply, tools, total: user + thinking + reply + tools }
  messageCompositionCache.set(message, { signature, value })
  return value
}

function contentComposition(messages) {
  const total = { user: 0, thinking: 0, reply: 0, tools: 0, total: 0 }
  for (const message of messages) {
    if (message.compact) continue
    const part = compositionOf(message)
    total.user += part.user
    total.thinking += part.thinking
    total.reply += part.reply
    total.tools += part.tools
    total.total += part.total
  }
  return total
}

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
  const { requests, last } = requestSummary(session, messages)
  const sum = key => requests.reduce((total, item) => total + Number(item[key] || 0), 0)
  // 正在流式输出的这一轮：外显速度用它当前累计的估算输出 / 首字之后的耗时，不再拿整个会话平均。
  const liveAssistant = messages.findLast(message => message.role === 'assistant' && message.isStreaming)
  const liveRequest = liveAssistant?.request || liveAssistant?.requests?.at(-1) || null
  const liveOutput = liveAssistant ? estimateTokens(`${liveAssistant.content || ''}${liveAssistant.reasoning || ''}`) : 0
  const liveFirstTokenAt = Number(liveRequest?.firstTokenAt || 0)
  // 没有正在生成的请求时，外显的是最后一次请求的实际速度；速度面板里的平均值仍单独保留。
  const requestTps = item => {
    const duration = Number(item?.durationMs || 0)
    const firstToken = Number(item?.firstTokenMs || 0)
    const generation = duration > firstToken ? duration - firstToken : duration
    return generation > 0 ? Number(item?.output || 0) / (generation / 1000) : 0
  }
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
  // 空会话没有内容可统计；发出第一条消息后才显示输入框下方的状态栏。
  if (!messages.length && !requests.length && !session.contextTokens) return null
  // 真实请求最多保留最近 18 次；旧会话没有请求记录时，用最近 18 条回复的估算值画同一张图。
  const estimatedSeries = usageApproximate
    ? messages
      .filter(message => message.role === 'assistant')
      .map(messageUsage)
      .filter(usage => usage.input + usage.output > 0)
      .slice(-18)
    : []
  // 速度面板按供应商 / 模型分组；旧请求没有记录来源时退回当前会话模型。
  const currentProvider = typeof session.provider === 'string'
    ? session.provider
    : (typeof session.model === 'object' ? session.model?.provider : '') || ''
  const currentModel = typeof session.model === 'string'
    ? session.model
    : (typeof session.model === 'object' ? session.model?.model : '') || ''
  const modelGroups = () => {
    if (usageApproximate || !requests.length) return []
    const groups = new Map()
    for (const item of requests) {
      const provider = item.provider || currentProvider
      const model = item.model || currentModel
      const key = `${provider}\u0000${model}`
      const group = groups.get(key) || {
        provider, model, count: 0, output: 0, durationMs: 0, durationCount: 0, firstTokenMs: 0, firstTokenCount: 0,
        latest: null,
      }
      group.count += 1
      group.output += Number(item.output || 0)
      const duration = Number(item.durationMs || 0)
      if (duration > 0) {
        group.durationMs += duration
        group.durationCount += 1
      }
      const firstToken = Number(item.firstTokenMs || 0)
      if (firstToken > 0) {
        group.firstTokenMs += firstToken
        group.firstTokenCount += 1
      }
      group.latest = {
        firstTokenMs: firstToken,
        durationMs: duration,
        tps: requestTps(item),
        at: Number(item.finishedAt || item.startedAt || 0),
      }
      groups.set(key, group)
    }
    return [...groups.values()].map(group => ({
      provider: group.provider || '未知供应商',
      model: group.model || '未知模型',
      count: group.count,
      averageFirstTokenMs: group.firstTokenCount ? group.firstTokenMs / group.firstTokenCount : 0,
      averageDurationMs: group.durationCount ? group.durationMs / group.durationCount : 0,
      averageTps: group.durationMs ? group.output / (group.durationMs / 1000) : 0,
      lastFirstTokenMs: group.latest?.firstTokenMs || 0,
      lastDurationMs: group.latest?.durationMs || 0,
      lastTps: group.latest?.tps || 0,
      lastAt: group.latest?.at || 0,
    })).sort((a, b) => (b.averageDurationMs - a.averageDurationMs) || (a.averageTps - b.averageTps))
  }
  return {
    approximate: usedApproximate || usageApproximate,
    context: {
      used,
      limit,
      threshold: store.config.compact.threshold,
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
    series: usageApproximate
      ? estimatedSeries
      : requests.slice(-18).map(item => ({ input: Number(item.input || 0), output: Number(item.output || 0), cache: Number(item.cache || 0) })),
    live: {
      running: Boolean(liveAssistant),
      output: liveOutput,
      firstTokenAt: liveFirstTokenAt,
      tps: last ? requestTps(last) : 0,
    },
    // 内容构成只在统计面板真正读取时才算；流式正文不经过这里。
    get composition() { return contentComposition(messages) },
    models: modelGroups(),
  }
}
