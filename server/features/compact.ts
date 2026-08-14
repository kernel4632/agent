/*
上下文压缩：把当前有效上下文总结为一条 summary assistant message，原消息永不删除。
下一次 Context.select 会自然形成“开头 3 + 摘要前 3 + 摘要 + 摘要后全部”。
*/
import { convertToModelMessages } from 'ai'
import { nanoid } from 'nanoid'
import Context from './context.ts'
import LLM from '../utils/llm.ts'
import Plugin from './plugin.ts'
import Store from '../store.ts'
import type { AgentMessage } from '../types.ts'
import Error from '../utils/error.ts'
import Session from '../commands/session.ts'
import type { UIMessageChunk } from 'ai'

const run = async (sessionID: string, signal = new AbortController().signal, onEvent?: (event: UIMessageChunk) => void | Promise<void>): Promise<AgentMessage> => {
    const session = Store.sessions[sessionID]
    if (!session) throw Error.notFound('Session not found')
    if (Store.runtimes[sessionID]!.status === 'running' && signal !== Store.runtimes[sessionID]!.abort.signal) throw Error.conflict('Cannot compact a running session')

    const result = await LLM.chat({
        provider: session.provider,
        modelID: session.model,
        messages: await convertToModelMessages(Context.select(session.messages)),
        instructions: Store.config.prompts.summary,
        signal,
    })
    const summary: AgentMessage = {
        ...result.message,
        id: nanoid(),
        role: 'assistant',
        createdAt: new Date().toISOString(),
        summary: true,
        usage: result.usage,
    }
    await Session.append(sessionID, summary)
    await onEvent?.({ type: 'data-compact-done', data: { message: summary }, transient: true })
    await Plugin.emit('message.append', { sessionID, message: summary })
    return summary
}

export default { run }
