/*
历史归一化基准：长会话的 tool-result 回填不能是 O(n²)。
用 bun 直接跑：bun node bench-history.mjs 2000
*/
import { History } from '../src/features/history.js'

// 造一个长会话：每轮一条 user + 一条带工具调用的 assistant + 一条 tool 结果消息
function buildSession(rounds) {
  const history = []
  for (let round = 0; round < rounds; round += 1) {
    history.push({ messageId: `u-${round}`, role: 'user', content: `问题 ${round}` })
    history.push({
      messageId: `a-${round}`,
      role: 'assistant',
      content: [
        { type: 'text', text: `回答 ${round}` },
        { type: 'tool-invocation', toolCallId: `call-${round}`, toolName: 'read_file', state: 'call', args: { path: `f${round}.js` } },
      ],
    })
    // 真实协议里 tool 结果单独一条消息，按顺序排在后面
    history.push({
      messageId: `t-${round}`,
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: `call-${round}`, output: { type: 'text', value: `内容 ${round}` } }],
    })
  }
  return { id: 'bench', provider: 'p', model: 'm', history, pending: [], toolTimings: {} }
}

const rounds = Number(process.argv[2] || 2000)
const source = buildSession(rounds)
console.log(`轮次 ${rounds}，历史消息 ${source.history.length} 条`)

// 预热一次，避免把 JIT 编译算进测量
History.normalize(source)

const best = []
for (let run = 0; run < 3; run += 1) {
  const start = performance.now()
  History.normalize(source)
  best.push(performance.now() - start)
}
console.log(`三次耗时(ms): ${best.map(value => value.toFixed(1)).join(' / ')}`)
console.log(`最快: ${Math.min(...best).toFixed(1)}ms`)
