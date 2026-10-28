/*
 * 控制工具：完成任务、询问用户。
 *
 * 这两个工具不碰磁盘也不碰外部服务，只改变 Agent 循环：调用后停下来。
 * 它们属于「never」类别，不参与工具审批，否则每轮收尾都要弹一次窗。
 * 调用示例：
 *   模型调用 attempt_completion({ result: '已经修好' })
 *   模型调用 ask_followup_question({ question: '要改哪个文件？' })
 */

const completion = {
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
        'When the task is complete, use this tool to present the final result and end the current task.',
        'Put the complete user-facing answer in the result parameter. Do not also write it as a normal assistant message.',
        'Do not use it to report intermediate progress.',
        'Parameters: result (required): the final result presented to the user.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: { result: { type: 'string', description: 'Complete final answer for the user.' } },
        required: ['result'],
    },
    execute: input => ({ stop: true, output: { type: 'text', value: input.result } }),
}

const question = {
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
        'Use it only when missing information blocks the task. The question must be specific and answerable.',
        'Parameters: - question (required): the specific question for the user.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: { question: { type: 'string', description: 'Specific question for the user.' } },
        required: ['question'],
    },
    execute: input => ({ stop: true, output: { type: 'text', value: input.question } }),
}

export { completion, question }
export default [completion, question]
