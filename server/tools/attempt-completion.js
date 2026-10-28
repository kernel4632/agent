/*
 * 完成任务工具：把最终结果交给用户并结束当前任务。
 *
 * 名字和描述对齐 Roo Code：attempt_completion({ result })。
 * 调用示例：模型调用 attempt_completion({ result: '已经修好' })，工具返回 { stop: true }。
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

export default attemptCompletion
