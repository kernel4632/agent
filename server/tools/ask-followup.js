/*
 * 询问用户工具：缺信息时暂停循环，等用户回答后继续。
 *
 * 名字和描述对齐 Roo Code：ask_followup_question({ question })。
 * 调用示例：模型调用 ask_followup_question({ question: '要改哪个文件？' })。
 */

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

export default askFollowupQuestion
