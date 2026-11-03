/*
 * 控制工具：提交本轮最终回复、询问用户。
 *
 * 这两个工具不碰磁盘也不碰外部服务，只改变 Agent 循环：调用后停下来。
 * 它们属于「never」类别，不参与工具审批，否则每轮收尾都要弹一次窗。
 * 调用示例：
 *   模型调用 attempt_completion({ result: '你好！' })
 *   模型调用 ask_followup_question({ question: '要改哪个文件？' })
 */

const completion = {
    name: 'attempt_completion',
    kind: 'never',
    ui: {
        view: 'completion',
        icon: 'check',
        title: '完成回复',
        summary: '本轮最终回复',
    },
    // 参考 Roo Code 的“最终内容放进 result，之后等待反馈”。通用助手还必须覆盖没有任务的问候与问答。
    description: [
        'Deliver the final reply to the current user message and end this assistant turn, then wait for the user to speak again.',
        'Use this tool for every completed reply: greetings, acknowledgements, casual conversation, direct answers, explanations, and completed tasks. The user does not need to have assigned a task.',
        'No previous tool use, file edit, or task execution is required. If you can answer directly, call this tool immediately with the answer.',
        'If you used other tools, wait for their actual results and check them before finishing. Report failures or incomplete work honestly instead of claiming success.',
        'Put the complete user-facing reply in result. Do not also send it as normal assistant text, and do not use this tool for intermediate progress.',
        'This ends only the current turn, not the conversation. The user can send feedback or a new message afterward.',
        'If missing information prevents an answer or further work, use ask_followup_question to ask the specific question instead.',
        'Parameters: result (required): the complete final reply to show the user, in the user\'s language.',
        'Example — user says "你好": { "result": "你好！" }',
        'Example — user asks "1 + 1 等于几？": { "result": "1 + 1 = 2。" }',
        'Example — completed work: { "result": "已修复布局问题，构建通过。" }',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: { result: { type: 'string', description: 'Complete final reply for this turn, including a greeting or direct answer when no task was assigned.' } },
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
