/*
演示数据源：不连后端，按 agent-core 1.2 的真实事件顺序回放一段对话，用来看界面和截图。
它像扩展一样用 patch 换掉 API 的几个方法，页面和 Agent 完全不知道；接真后端时删掉 main.ts 里那一行即可。

第一次发送：首次请求半路失败（片段撤掉）→ 4 秒后第 2 次尝试 → 思考 → 边写边冒的 shell 调用 → 实时输出 → 再读一个文件 → 正文回答。
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
      for (const line of lines) { await wait(450); emit({ type: 'tool-output', toolCallId, stream: 'stdout', data: line + '\n' }) }
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

// 第一次：重试 + 两个工具 + 正文。
async function explore(play: Player) {
  await play.request(1)
  await play.stream('reasoning', '用户想知道入口文件在哪里，还要统计前端组件数量。先列一下目录结构，看看 web/src 下面都有哪些文件，再决定要不要打开入口', 40)
  await play.fail(1, '上游服务暂时过载（529 Overloaded），稍后自动重试', 4000)
  await play.request(2)
  await play.stream('reasoning', '用户想知道入口在哪，并统计组件数量。先列出 web/src 的目录结构，再打开入口文件确认启动流程。')
  await play.call('call_ls', 'shell', { command: 'find web/src -name "*.vue" -o -name "*.ts" | sort' })
  const first = await play.end(5120, 86, 3072)
  await play.run('call_ls', 'shell', ['web/src/Agent.ts', 'web/src/App.vue', 'web/src/Extension.ts', 'web/src/api.ts', 'web/src/components/Composer.vue', 'web/src/components/History.vue', 'web/src/components/ToolCall.vue', 'web/src/main.ts'], '共 17 个文件，其中 12 个 .vue 组件')
  await play.step(first)
  await play.request(1)
  await play.stream('reasoning', '入口应该是 main.ts，读一下确认它挂载了什么。')
  await play.call('call_read', 'read_file', { path: 'web/src/main.ts' })
  const second = await play.end(6480, 41, 5120)
  await play.run('call_read', 'read_file', [], "import { createApp } from 'vue'\nimport App from './App.vue'\n…\nExtension.register({ History, Composer, … })\ncreateApp(App).mount('#app')")
  await play.step(second)
  await play.request(1)
  await play.stream('text', '入口是 **`web/src/main.ts`**，启动只做三件事：\n\n1. 把所有组件登记进组件表 `Extension.register(...)`，扩展之后从这张表里换组件；\n2. 加载扩展；\n3. 挂载 `App.vue`。\n\n前端一共 **12 个组件**，都在 `components/` 下：\n\n| 类别 | 组件 |\n| --- | --- |\n| 对话流 | History、UserMessage、AssistantMessage |\n| 过程 | Process、Thinking、ToolCall、RequestStatus |\n| 状态 | ErrorMessage、CompactMessage |\n| 输入 | Composer、Stats |\n\n要不要我接着看看 `History.group` 是怎么分组的？', 16)
  await play.step(await play.end(7012, 228, 6400))
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
  await play.stream('text', '用户在了解新前端的结构：入口 main.ts 登记组件表、加载扩展、挂载 App；共 12 个组件；History.group 负责分组。', 20)
  await play.end(7600, 64)
  play.emit({ type: 'compact-end', reason: 'manual', summary: '用户在了解新前端的结构：入口 main.ts 登记组件表、加载扩展、挂载 App；共 12 个组件；History.group 负责分组。', before: 7600, after: 1200, budget: 256000, compactThreshold: 0.8, ratio: 0.6, ratioSource: 'usage', chars: 12000, media: 0, usage: { inputTokens: 7600, outputTokens: 64, totalTokens: 7664, cacheReadTokens: 0, cacheWriteTokens: 0 } })
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
