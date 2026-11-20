/*
测试夹具：假模型和临时数据目录。这个文件不叫 *.test.js，bun test 不会把它当测试。
假模型用 AI SDK 的 MockLanguageModelV4，按脚本回放回复，全程没有网络请求。
*/

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'

const NONE = { inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: undefined, text: undefined, reasoning: undefined } }
const usageOf = (input = 100) => ({ inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } })

function abort(signal) {
    return new Promise((_, reject) => {
        if (!signal) return
        if (signal.aborted) reject(signal.reason)
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
}

const contentOf = (step) => [
    ...(step.reasoning ? [{ type: 'reasoning', text: step.reasoning }] : []),
    ...(step.text ? [{ type: 'text', text: step.text }] : []),
    ...(step.calls ?? []).map((call, index) => ({ type: 'tool-call', toolCallId: call.id ?? `c${index}`, toolName: call.name, input: JSON.stringify(call.input ?? {}) })),
]

// 按顺序回放 steps 的假模型。脚本用完后一直回最后一步。步骤也可以是函数（含异步，用来卡住请求）。
export function script(steps, modelId = 'mock-model') {
    let index = 0
    const next = async () => { const at = index++; const raw = steps[Math.min(at, steps.length - 1)]; return typeof raw === 'function' ? await raw(at) : raw }
    const calls = []
    const model = new MockLanguageModelV4({
        modelId,
        doGenerate: async (options) => {
            calls.push(options)
            const step = await Promise.race([next(), abort(options.abortSignal)])
            return { content: contentOf(step), finishReason: { unified: step.calls?.length ? 'tool-calls' : 'stop', raw: undefined }, usage: step.noUsage ? NONE : usageOf(step.inputTokens), warnings: [] }
        },
        doStream: async (options) => {
            calls.push(options)
            const step = await Promise.race([next(), abort(options.abortSignal)])
            const chunks = [{ type: 'stream-start', warnings: [] }]
            if (step.reasoning) chunks.push({ type: 'reasoning-start', id: 'r' }, ...[...step.reasoning].map(delta => ({ type: 'reasoning-delta', id: 'r', delta })), { type: 'reasoning-end', id: 'r' })
            if (step.text) chunks.push({ type: 'text-start', id: 't' }, ...[...step.text].map(delta => ({ type: 'text-delta', id: 't', delta })), { type: 'text-end', id: 't' })
            for (const part of contentOf(step).filter(one => one.type === 'tool-call')) {
                const half = Math.ceil(part.input.length / 2)
                chunks.push({ type: 'tool-input-start', id: part.toolCallId, toolName: part.toolName }, { type: 'tool-input-delta', id: part.toolCallId, delta: part.input.slice(0, half) }, { type: 'tool-input-delta', id: part.toolCallId, delta: part.input.slice(half) }, { type: 'tool-input-end', id: part.toolCallId }, part)
            }
            chunks.push({ type: 'finish', finishReason: { unified: step.calls?.length ? 'tool-calls' : 'stop', raw: undefined }, usage: step.noUsage ? NONE : usageOf(step.inputTokens) })
            return { stream: simulateReadableStream({ chunks }) }
        },
    })
    return { model, calls }
}

// 流式回复在写出前半段正文后停住，调用 resume() 才写完。用来测进行中的尾巴和重连。
export function holdable(text = '你好世界') {
    let resume
    const wait = new Promise(resolve => { resume = resolve })
    const chars = [...text]
    const mid = Math.ceil(chars.length / 2)
    const model = new MockLanguageModelV4({
        modelId: 'mock-model',
        doGenerate: async () => ({ content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: undefined }, usage: usageOf(), warnings: [] }),
        doStream: async (options) => ({
            stream: ReadableStream.from((async function* () {
                yield { type: 'stream-start', warnings: [] }
                yield { type: 'text-start', id: 't' }
                for (const delta of chars.slice(0, mid)) yield { type: 'text-delta', id: 't', delta }
                await Promise.race([wait, abort(options.abortSignal)])
                for (const delta of chars.slice(mid)) yield { type: 'text-delta', id: 't', delta }
                yield { type: 'text-end', id: 't' }
                yield { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: usageOf() }
            })()),
        }),
    })
    return { model, resume }
}

export function tools(files) {
    const dir = mkdtempSync(join(tmpdir(), 'agent-tools-'))
    for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source)
    return dir
}

export const tool = (name, body, extra = '') => `export default { name: '${name}', description: '${name} tool', parameters: { type: 'object', properties: { x: { type: 'number' } } }, ${extra} async run(args) { ${body} } }\n`

export function dataDir() {
    const dir = mkdtempSync(join(tmpdir(), 'agent-home-'))
    process.env.AGENT_HOME = dir
    return dir
}

export function restoreHome(original) {
    if (original === undefined) delete process.env.AGENT_HOME
    else process.env.AGENT_HOME = original
}
