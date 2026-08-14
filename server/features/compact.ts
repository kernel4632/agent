/*
上下文压缩：把传入的有效上下文总结为一条 summary assistant message。
模型能力、控制器和流接收器都由调用方注入；本模块不读写 Store。
*/
import { convertToModelMessages, type UIMessageChunk } from 'ai'
import { nanoid } from 'nanoid'
import Context from './context.ts'
import type { AgentMessage } from '../types.ts'

const run = async (messages: AgentMessage[], {
    signal,
    receive,
    chat,
}: {
    signal: AbortSignal
    receive?: (event: UIMessageChunk) => void | Promise<void>
    chat: (messages: Awaited<ReturnType<typeof convertToModelMessages>>, options: {
        signal: AbortSignal
        receive?: (event: UIMessageChunk) => void | Promise<void>
    }) => Promise<{ message: AgentMessage; usage?: AgentMessage['usage'] }>
}): Promise<AgentMessage> => {
    const result = await chat(await convertToModelMessages(Context.select(messages)), { signal, receive })
    return {
        ...result.message,
        id: nanoid(),
        role: 'assistant',
        createdAt: new Date().toISOString(),
        summary: true,
        usage: result.usage,
    }
}

export default { run }
