/*
 * 子任务：主 agent 把一件独立的探索工作委托出去，只需拿回结论。
 *
 * 为什么要有它：主 agent 读一堆文件找答案，这些文件的全text都留在它自己的历史里，
 * 上下文很快被塞满，后面真正要干活时已经没地方放东西了。委托出去之后，
 * 子 agent 在自己的历史里翻，只把结论交回来，主 agent 的历史干净得像没读过那些文件。
 *
 * 说明几点取舍：
 *   - 子 agent 拿不到 task 工具，所以不能再往下委托，不会无限套娃。
 *   - 子 agent 的报错只作为结论文本回到主 agent，不会打断整个任务。
 *   - 主任务被停止时子任务一起停（共用一个取消信号）。
 * 调用示例：
 *   const task = Delegation.build({ config, tools })
 *   // 这是一个 AI SDK 形状的工具对象，和别的工具拼在一起交给 Agent
 */

import Agent from '@kernel4632/agent-core'
import Approval from './approval.js' // 子 agent 也要过同一道审批关口。
import SSE from '../utils/sse.js' // 子任务的进度也推给前端，用户看得见它在忙什么。

// --- 做出一张"子 agent 能用的工具表" ---
const subTools = tools => {
    // 从主 agent 的工具里去掉 task：子 agent 不能再委托，否则可以无限套下去。
    const schema = { ...tools.schema }
    delete schema.task
    return { schema, handlers: tools.handlers }
}

// --- 造出 task 工具 ---
/**
 * 造出 task 工具。
 * @param {{ config: object, tools: object, sessionId?: string }} input
 *   sessionId 是这条会话的编号：子 agent 的审批要回到同一个会话，
 *   用户才能在界面上看到并回答"子任务想读这个文件"。
 */
const build = ({ config, tools, sessionId }) => {
    const usable = subTools(tools)
    let counter = 0

    return {
        name: 'task',
        description: [
            'Delegate one self-contained piece of research to a separate agent and get back only its conclusion.',
            'Use it when finding the answer means reading many files: those files stay out of your own context, so you keep room for the real work.',
            'The sub-agent runs with the same read tools but cannot ask you questions and cannot delegate further — so state everything it needs in the prompt: what to look into, what to answer.',
            'Do not use it for a single quick lookup — that is cheaper to do yourself with file_read or grep.',
            'Parameters:',
            '- description (required): a few words naming this delegation, shown to the user.',
            '- prompt (required): the complete instructions — the sub-agent cannot see this conversation.',
        ].join('\n'),
        inputSchema: {
            type: 'object',
            properties: {
                description: { type: 'string', description: '用三五个字说这次委托要干什么，会显示给用户看' },
                prompt: { type: 'string', description: '完整的交代：要查什么、查完回答什么。子 agent 看不到你的对话，这里得说全' },
            },
            required: ['description', 'prompt'],
        },

        async execute({ description, prompt }, { abortSignal }) {
            // 每次委托一个独立编号，前端据此把子任务的进度和别的任务分开。
            const id = `task-${++counter}`

            // 子 agent 有自己的历史，跑完就丢。配置和主 agent 一样。
            const agent = Agent.create({
                history: [],
                config,
                tools: usable,
                callbacks: {
                    onToolCall: call => SSE.send({ id, data: { type: 'subagent-tool', description, ...call } }),
                    onToolResult: result => SSE.send({ id, data: { type: 'subagent-tool-result', description, ...result } }),
                    /*
                     * 子 agent 走的是同一道审批关口。这一句不能省：
                     * 少了它，子任务里的读文件和执行命令完全不问用户，.agentignore 也拦不住，
                     * 而且不报任何错——表现只是"某些密钥文件莫名其妙被读到了"。
                     * 审批请求回到主会话，用户看到的是"子任务想读这个文件"。
                     */
                    onPermission: call => Approval.check({ sessionId, ...call }),
                },
            })

            // 主任务被停止时子任务一起停，不留下一个还在后台翻文件的过程。
            const stop = () => agent.stop()
            abortSignal?.addEventListener('abort', stop, { once: true })

            try {
                const result = await agent.send({ input: prompt })
                // 只把结论交回主 agent；子 agent 读过的文件全留在它自己的历史里，已经随它一起丢掉。
                return { description, reason: result.reason, conclusion: result.text }
            } catch (error) {
                // 子任务失败只是一条结论，主 agent 可以自己决定换个办法还是直接告诉用户。
                return { description, error: error.message }
            } finally {
                abortSignal?.removeEventListener('abort', stop)
            }
        },
    }
}

export default { build }
