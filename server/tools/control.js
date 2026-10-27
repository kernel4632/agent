/*
 * Agent 控制工具：结束循环、向用户提问、记任务清单。
 *
 * 工具只描述模型可以触发的动作，不读取会话数据，也不发送 HTTP 反馈。
 * 调用 attempt_completion / ask_followup_question 后工具返回 stop: true，主循环停止，等用户下一条消息。
 *
 * attempt_completion 的名称和描述对齐 Roo Code：它不是普通回复，而是整轮任务的收尾动作。
 */

// --- 结束 Agent 循环 ---
const attemptCompletion = {
    name: 'attempt_completion',
    kind: 'never',
    ui: {
        view: 'completion',
        icon: 'check',
        title: '完成任务',
        summary: '最终结果',
    },
    description: [
        'After each tool use, wait for its result before deciding what to do next.',
        'When the task is complete — the requested work is done or the question is fully answered — use this tool to present the final result to the user and end the current task. This is the only tool that ends the task.',
        'Use it even for a simple answer with no tool actions: answering the user is completing the task. Do not end with a normal assistant message instead.',
        'Do not use it to report intermediate progress. If there is still a next step (reading, editing, running a command), do that first.',
        'The result must be final, complete prose. Do not end it with a question or an offer for further assistance.',
        'Put the complete user-facing answer in the result parameter. Do not also write it as a normal assistant message before calling this tool.',
        'Parameters: result (required): the final result presented to the user.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: { result: { type: 'string', description: 'Complete final answer for the user, written here instead of a normal assistant message.' } },
        required: ['result'],
    },
    // attempt_completion 的结果会让主循环停止，不再请求下一轮模型。
    execute: input => ({ stop: true, output: { type: 'text', value: input.result } }),
}

// --- 暂停 Agent 循环并询问用户 ---
const askFollowupQuestion = {
    name: 'ask_followup_question',
    kind: 'never',
    ui: {
        view: 'question',
        icon: 'info',
        title: '询问用户',
        summary: '{question}',
    },
    description: [
        'Ask the user a question to gather additional information needed to complete the task, then stop and wait for the answer.',
        'Use it only when you are blocked by missing information: which file to change, which account to use, which approach to take. Do not use it to hand the work back with a vague "what should I do?".',
        'The question must be specific and answerable. The user’s answer arrives as the next message, and the task continues from there.',
        'Parameters:',
        '- question (required): the specific question for the user.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: { question: { type: 'string', description: 'Specific question for the user.' } },
        required: ['question'],
    },
    // 提问同样停止循环，等用户补充信息后再发送新消息。
    execute: input => ({ stop: true, output: { type: 'text', value: input.question } }),
}

export default [attemptCompletion, askFollowupQuestion] // 一个文件导出两个控制工具。
