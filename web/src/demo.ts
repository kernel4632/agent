/*
演示数据源：不连后端，按 agent-core 1.2 的真实事件顺序回放一段对话，用来看界面和截图。
它像扩展一样用 patch 换掉 API 的几个方法，页面和 Agent 完全不知道；接真后端时删掉 main.ts 里那一行即可。

第一次发送：一整轮真实的 agent 过程——首次请求半路失败（片段撤掉）、4 秒后重试；之后说几句、跑测试、思考、
读文件和搜索、再思考、改文件、再跑测试，最后给出结论（结论把标题、加粗、行内代码、链接、列表、表格、引用、ts/bash 代码块都用上，用来看 Markdown 渲染）。
之后的发送：一段普通回答；消息里带“失败”两个字会重试两次后最终失败。手动压缩走 compact-start … compact-end。
*/

import type { Event, ToolCall } from '@kernel4632/agent-core'
import { API, type Listener, type Model } from './api'
import { Extension } from './Extension'

const models: Model[] = [
  { id: 'grok-4', name: 'Grok 4', efforts: ['low', 'medium', 'high'], context: 256000 },
  { id: 'grok-4-fast', name: 'Grok 4 Fast', context: 2000000 },
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', efforts: ['low', 'medium', 'high'], context: 200000 },
  { id: 'deepseek-chat', name: 'DeepSeek V3', context: 128000 },
]
const config = { model: 'grok-4', effort: 'medium' as string | undefined }
let controller: AbortController | null = null
let sent = 0

// 一次回放：所有等待都能被停止打断；一次请求的片段同时攒成 step 里的 reply。
function player(listener: Listener, signal: AbortSignal) {
  const wait = (ms: number) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('stopped')) }, { once: true })
  })
  const emit = (event: Event) => { if (!signal.aborted) listener(event) }
  let current = { start: 0, first: 0, compact: undefined as true | undefined, content: [] as any[], calls: [] as ToolCall[], step: 0 }
  return {
    wait,
    emit,
    async request(attempt = 1, compact?: true) {
      await wait(compact ? 300 : 500)
      current = { ...current, start: Date.now(), first: 0, compact, content: [], calls: [] }
      emit({ type: 'request-start', model: config.model, start: current.start, attempt, compact })
      await wait(700)
    },
    async stream(type: 'text' | 'reasoning', text: string, pace = 28) {
      current.first ||= Date.now() - current.start
      current.content.push({ type, text })
      for (let index = 0; index < text.length; index += 3) { emit({ type, text: text.slice(index, index + 3), compact: current.compact } as Event); await wait(pace) }
    },
    async call(toolCallId: string, toolName: string, input: Record<string, unknown>) {
      emit({ type: 'tool-input-start', toolCallId, toolName })
      const raw = JSON.stringify(input)
      for (let index = 0; index < raw.length; index += 4) { emit({ type: 'tool-input', toolCallId, delta: raw.slice(index, index + 4) }); await wait(70) }
      const call = { toolCallId, toolName, input }
      current.calls.push(call)
      current.content.push({ type: 'tool-call', ...call })
      emit({ type: 'tool-call', call })
    },
    async end(input: number, output: number, cacheRead?: number) {
      await wait(200)
      const request = { model: config.model, start: current.start, first: current.first || undefined, duration: Date.now() - current.start, usage: cacheRead === undefined ? { input, output } : { input, output, cacheRead } }
      emit({ type: 'request-end', request, usage: { inputTokens: input, outputTokens: output, totalTokens: input + output, cacheReadTokens: cacheRead ?? 0, cacheWriteTokens: 0 }, compact: current.compact })
      return request
    },
    async fail(attempt: number, message: string, delay?: number) {
      emit({ type: 'request-error', attempt, error: { kind: 'server', statusCode: 529, message }, ...(delay ? { retry: { delay, maxTries: 5 } } : {}) })
      if (delay) await wait(delay)
    },
    async run(toolCallId: string, toolName: string, lines: string[], value: string) {
      emit({ type: 'tool-run', toolCallId, toolName })
      for (const line of lines) { await wait(320); emit({ type: 'tool-output', toolCallId, stream: 'stdout', data: line + '\n' }) }
      await wait(300)
      emit({ type: 'tool-result', result: { toolCallId, toolName, input: current.calls.find(call => call.toolCallId === toolCallId)?.input, output: { type: 'text', value } } })
    },
    async step(request: any, results: any[] = []) {
      current.step += 1
      const text = current.content.filter(part => part.type === 'text').map(part => part.text).join('')
      const usage = { inputTokens: request.usage.input, outputTokens: request.usage.output, totalTokens: 0, cacheReadTokens: request.usage.cacheRead ?? 0, cacheWriteTokens: 0 }
      emit({ type: 'step', step: current.step, results, reply: { text, reasoning: '', toolCalls: current.calls, usage, request, messages: [{ role: 'assistant', content: current.content }] } })
      await wait(100)
    },
  }
}

type Player = ReturnType<typeof player>

// 第一次：像真实 agent 一样边说边想边调工具，五次请求；第一次请求半路失败后自动重试。
async function explore(play: Player) {
  await play.request(1)
  await play.stream('reasoning', '**定位失败的测试**\n\n用户说 bun test 有一个用例挂了，要找出是哪个、为什么，并修好。\n\n先不要猜，直接把测试跑一遍：看失败的是哪个文件、哪条断言，期望值和实际值分别是多少。\n\n跑完之后再决定读哪段实现', 45)
  await play.fail(1, '上游服务暂时过载（529 Overloaded），稍后自动重试', 4000)

  await play.request(2)
  await play.stream('text', '好的，我先把 `bun test` 跑一遍，看看**具体是哪个用例**挂了。', 22)
  await play.call('call_test', 'shell', { command: 'cd web && bun test', timeout: 60000 })
  const first = await play.end(5120, 64, 3072)
  await play.run('call_test', 'shell', ['bun test v1.4.4', '', 'tests/group.test.ts:', '✓ 正文打断 Process [0.42ms]', '✓ 工具结果按 toolCallId 挂上 [0.18ms]', '✗ 连续重试报错合成一条 ErrorMessage [1.03ms]', '  expect(items.filter(isError)).toHaveLength(1)', '  Expected length: 1', '  Received length: 2', '', ' 11 pass', ' 1 fail', 'Ran 12 tests across 3 files. [214ms]'], '11 pass, 1 fail（tests/group.test.ts：连续重试报错合成一条 ErrorMessage）')
  await play.step(first)

  await play.request(1)
  await play.stream('reasoning', '**读 group 的实现**\n\n失败的是“连续重试报错合成一条”。期望 1 条 ErrorMessage，实际 2 条，说明最终失败那条没有把前面的重试合进去。\n\n需要看 History.group 里处理 role:error 的分支：重试的报错会先作为请求条留在 Process 里，最终失败时应该把它们一起拿出来。\n\n同时搜一下 final 标记在哪些地方用到，确认 core 写进历史的字段名，免得改错地方。', 45)
  await play.stream('text', '挂的是 `History.group` 合并重试报错的用例：**期望 1 条，实际 2 条**。我看一下实现，顺便查查 `final` 标记在哪里用到。', 20)
  await play.call('call_read', 'read_file', { path: 'web/src/components/History.vue', offset: 48, limit: 20 })
  await play.call('call_grep', 'grep', { pattern: 'final', path: 'web/src' })
  const second = await play.end(6480, 120, 5120)
  await play.run('call_read', 'read_file', [], "48  if (message.role === 'error') {\n49    const retried = tail?.kind === 'request' && tail.errors ? tail.errors : []\n50    if (message.request?.final) {\n51      flush()\n52      items.push({ kind: 'error', errors: [message] })")
  await play.run('call_grep', 'grep', ['web/src/Agent.ts:88:  ...(event.retry ? { attempt } : { final: true })', 'web/src/components/History.vue:50:    if (message.request?.final) {'], '2 处匹配')
  await play.step(second)

  await play.request(1)
  await play.stream('reasoning', '**原因**\n\n第 50 行直接 push 了 [message]，没有带上 retried，而且前面的重试已经作为请求条留在 Process 里，所以出现两条。应该先把尾部的重试请求条拿出来，再和最终失败合成一条。', 45)
  await play.stream('text', '找到原因了，有两处：\n\n- 最终失败那条**没有带上**前面的重试；\n- 前面的重试也没从过程里拿出来。\n\n我改一下第 50 行。', 20)
  await play.call('call_edit', 'edit_file', { path: 'web/src/components/History.vue', old: "flush()\n      items.push({ kind: 'error', errors: [message] })", new: "if (retried.length) steps.pop()\n      flush()\n      items.push({ kind: 'error', errors: [...retried, message] })" })
  const third = await play.end(7012, 210, 6400)
  await play.run('call_edit', 'edit_file', [], '已修改 web/src/components/History.vue（+2 −1）')
  await play.step(third)

  await play.request(1)
  await play.call('call_retest', 'shell', { command: 'cd web && bun test' })
  const fourth = await play.end(7380, 32, 7000)
  await play.run('call_retest', 'shell', ['bun test v1.4.4', '', 'tests/group.test.ts:', '✓ 正文打断 Process [0.40ms]', '✓ 工具结果按 toolCallId 挂上 [0.17ms]', '✓ 连续重试报错合成一条 ErrorMessage [0.31ms]', '', ' 12 pass', ' 0 fail', 'Ran 12 tests across 3 files. [198ms]'], '12 pass, 0 fail')
  await play.step(fourth)

  await play.request(1)
  await play.stream('text', "## 修好了\n\n测试全部通过：**12 pass, 0 fail**。问题出在 `History.group` 合并重试报错的分支，前端其他地方没动。\n\n### 原因\n\nagent-core 1.2 的 [request-error 事件](https://github.com/kernel4632/agent#events) 在**还会重试**时带 `retry`，最终失败时写进历史的那条带 `final: true`。`group` 遇到 `final` 时：\n\n1. 只把这一条做成 ErrorMessage，**没带上**前面的重试；\n2. 前面的重试还作为请求条留在 Process 里；\n3. 于是界面上出现了两条报错。\n\n> 预期是一次失败只占一条：写明「已自动重试 N 次」，末尾带继续。\n\n### 改动\n\n| 文件 | 改动 | 行数 |\n| --- | --- | --- |\n| `web/src/components/History.vue` | 最终失败时收回尾部的重试请求条 | +2 −1 |\n| `tests/group.test.ts` | 无需修改，原用例即覆盖 | 0 |\n\n```ts\nif (message.role === 'error') {\n  const retried = tail?.kind === 'request' && tail.errors ? tail.errors : []\n  if (message.request?.final) {\n    if (retried.length) steps.pop()   // 尾部的重试请求条拿出来\n    flush()\n    items.push({ kind: 'error', errors: [...retried, message] })\n  }\n}\n```\n\n### 验证\n\n```bash\ncd web && bun test        # 12 pass, 0 fail\nbun run build             # 类型检查 + 打包\n```\n\n要不要我顺手给**连续失败 3 次以上**的情况补一个用例？", 6)
  await play.step(await play.end(7712, 236, 7040))
}

// 之后的普通发送；带“失败”就重试两次后放弃。
async function reply(play: Player, text: string) {
  if (text.includes('失败')) {
    for (const attempt of [1, 2]) { await play.request(attempt); await play.fail(attempt, '上游服务暂时过载（529 Overloaded），稍后自动重试', 2500) }
    await play.request(3)
    return play.fail(3, '上游服务暂时过载（529 Overloaded）：已达到最大重试次数')
  }
  await play.request(1)
  await play.stream('reasoning', '直接回答即可。')
  await play.stream('text', '`History.group(state)` 是一个导出的纯函数：按历史顺序走一遍，把没说话的思考和工具调用收进同一个 Process，正文单独成段，连续的重试报错合成一条。扩展 patch 它就能改整个对话的显示结构。', 18)
  await play.step(await play.end(7480, 96))
}

async function compact(play: Player) {
  play.emit({ type: 'compact-start', reason: 'manual' })
  await play.request(1, true)
  await play.stream('text', '用户让修复 bun test 里挂掉的用例；已定位到 History.group 合并重试报错的分支并修好，12 个测试全部通过。', 20)
  await play.end(7600, 64)
  play.emit({ type: 'compact-end', reason: 'manual', summary: '用户让修复 bun test 里挂掉的用例；已定位到 History.group 合并重试报错的分支并修好，12 个测试全部通过。', before: 7600, after: 1200, budget: 256000, compactThreshold: 0.8, ratio: 0.6, ratioSource: 'usage', chars: 12000, media: 0, usage: { inputTokens: 7600, outputTokens: 64, totalTokens: 7664, cacheReadTokens: 0, cacheWriteTokens: 0 } })
}

// 回放期间可被 API.stop 打断；打断后像真后端一样直接关闭推送。
async function replay(listener: Listener, script: (play: Player) => Promise<unknown>) {
  controller = new AbortController()
  try { await script(player(listener, controller.signal)) } catch (error) { if (!controller.signal.aborted) throw error }
  controller = null
}

Extension.patch(API, 'load', () => async () => ({ history: [], models, ...config }), 'demo')
Extension.patch(API, 'extensions', () => async () => [], 'demo')
Extension.patch(API, 'configure', () => async (patch: typeof config) => { Object.assign(config, patch) }, 'demo')
Extension.patch(API, 'stop', () => async () => { controller?.abort() }, 'demo')
Extension.patch(API, 'compact', () => (listener: Listener) => replay(listener, compact), 'demo')
Extension.patch(API, 'send', () => ({ input }: { input?: unknown }, listener: Listener) =>
  replay(listener, play => sent++ === 0 ? explore(play) : reply(play, typeof input === 'string' ? input : '')), 'demo')
