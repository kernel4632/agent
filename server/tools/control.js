/*
 * Agent 控制工具：结束循环、向用户提问、记任务清单。
 *
 * 工具只描述模型可以触发的动作，不读取会话数据，也不发送 HTTP 反馈。
 * 调用 attempt_completion / ask 后工具返回 stop: true，主循环停止，等用户下一条消息。
 *
 * attempt_completion 的名称和描述对齐 Roo Code：它不是普通回复，而是整轮任务的收尾动作。
 */

// --- 结束 Agent 循环 ---
const attemptCompletion = {
    name: 'attempt_completion',
    description: [
        'After each tool use, wait for its result before deciding what to do next.',
        'When the task is complete — the requested work is done or the question is fully answered — use this tool to present the final result to the user and end the current task. This is the only tool that ends the task.',
        'Use it even for a simple answer with no tool actions: answering the user is completing the task. Do not end with a normal assistant message instead.',
        'Do not use it to report intermediate progress. If there is still a next step (reading, editing, running a command), do that first.',
        'The result must be final, complete prose. Do not end it with a question or an offer for further assistance.',
        'Parameters: result (required): the final result presented to the user.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: { result: { type: 'string', description: 'Final result presented to the user, complete and self-contained.' } },
        required: ['result'],
    },
    // attempt_completion 的结果会让主循环停止，不再请求下一轮模型。
    execute: input => ({ stop: true, output: { type: 'text', value: input.result } }),
}

// --- 暂停 Agent 循环并询问用户 ---
const ask = {
    name: 'ask',
    description: [
        '向用户提出一个问题，然后停下等回答。',
        '只在缺了关键信息、不问就做不下去时用：要改哪个文件、账号是什么、按哪种方案做。',
        '问题要具体，能答就答，不要把"你想让我做什么"这种空泛问题丢回给用户。',
        '用户的回答会作为下一条消息进来，届时继续。',
        '参数 question：要问的问题。',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: { question: { type: 'string', description: '要问用户的问题，要具体' } },
        required: ['question'],
    },
    // ask 同样停止循环，等用户补充信息后再发送新消息。
    execute: input => ({ stop: true, output: { type: 'text', value: input.question } }),
}

export default [attemptCompletion, ask] // 一个文件导出两个控制工具。
