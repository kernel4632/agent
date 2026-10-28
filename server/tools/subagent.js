/*
 * 子智能体工具：主 agent 把一件独立的探索工作委托出去，只拿回结论。
 *
 * 子 agent 有自己的历史，翻过的文件留在它自己那边，主 agent 的上下文保持干净。
 * 它和主 agent 共用同一套工具、同一个审批关口，所以子任务也绕不过权限规则。
 * 最多往下开两层；主任务被停止时子任务一起停。
 * 调用示例：
 *   const tool = Delegation.build({ config, tools, sessionId })   // 标准工具对象
 */

import Agent from '@kernel4632/agent-core'
import Approval from '../features/approval.js'
import SSE from '../utils/sse.js'

// 最多往下开两层：主 agent → 子 agent → 孙 agent。
const MAX_DEPTH = 2

const ui = {
    view: 'subtask',
    icon: 'branch',
    title: '创建子任务',
    summary: '{description}',
}

// --- 做出一张"子 agent 能用的工具表"：去掉这一层的 new_task，下一层自己装 ---
const subTools = tools => {
    const schema = { ...tools.schema }
    delete schema.new_task
    return { schema, handlers: tools.handlers }
}

// --- 某一层的 agent 能拿到哪些工具 ---
const toolsForDepth = ({ config, tools, sessionId, depth, maxDepth = MAX_DEPTH }) => {
    const base = subTools(tools)
    if (depth >= maxDepth) return base
    return Agent.tool.merge(base, Agent.tool.adopt({
        new_task: build({ config, tools, sessionId, depth, maxDepth }),
    }))
}

// --- 真正跑一次子任务：建临时 Agent，把进度推回主会话 ---
const runSubtask = async ({ config, tools, sessionId, id, description, prompt, abortSignal }) => {
    const agent = Agent.create({
        history: [],
        config,
        tools,
        callbacks: {
            onToolCall: call => SSE.send({ id: sessionId, data: { type: 'subagent-tool', taskId: id, description, ...call } }),
            onToolResult: result => SSE.send({ id: sessionId, data: { type: 'subagent-tool-result', taskId: id, description, ...result } }),
            // 子 agent 的审批回到同一个会话，用户能看到"子任务想读这个文件"。
            onPermission: call => Approval.check({ sessionId, ...call }),
        },
    })

    // 主任务被停止时子任务一起停，不留下一个还在后台翻文件的过程。
    const stop = () => agent.stop()
    abortSignal?.addEventListener('abort', stop, { once: true })

    try {
        const result = await agent.send({ input: prompt })
        return { description, reason: result.reason, conclusion: result.text }
    } catch (error) {
        // 子任务失败只是一条结论，主 agent 可以自己决定换个办法还是直接告诉用户。
        return { description, error: error.message }
    } finally {
        abortSignal?.removeEventListener('abort', stop)
    }
}

// --- 造出 new_task 工具 ---
const build = ({ config, tools, sessionId, depth = 0, maxDepth = MAX_DEPTH }) => {
    const usable = toolsForDepth({ config, tools, sessionId, depth: depth + 1, maxDepth })
    let counter = 0

    return {
        name: 'new_task',
        kind: 'subtask',
        ui,
        description: [
            'Delegate one self-contained piece of research to a separate agent and get back only its conclusion.',
            'Use it when finding the answer means reading many files: those files stay out of your own context.',
            'The sub-agent runs with the same tools and cannot ask you questions — state everything it needs in the prompt.',
            'If you have several independent pieces, emit several new_task calls in the same step — they run in parallel.',
            'Parameters:',
            '- description (required): a few words naming this delegation, shown to the user.',
            '- prompt (required): the complete instructions — the sub-agent cannot see this conversation.',
        ].join('\n'),
        inputSchema: {
            type: 'object',
            properties: {
                description: { type: 'string', description: '用三五个字说这次委托要干什么，会显示给用户看' },
                prompt: { type: 'string', description: '完整的交代：要查什么、查完回答什么。子 agent 看不到你的对话' },
            },
            required: ['description', 'prompt'],
        },

        // 第二参必须可省：执行器只保证传 input，不传时就没有取消信号。
        execute({ description, prompt }, { abortSignal } = {}) {
            const id = `new_task-${depth}-${++counter}`
            return runSubtask({ config, tools: usable, sessionId, id, description, prompt, abortSignal })
        },
    }
}

export default { build, toolsForDepth, MAX_DEPTH, ui }
