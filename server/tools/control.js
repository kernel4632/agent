/* 两个控制工具都明确结束当前 Agent 循环。 */
const finish = {
    name: 'finish',
    description: 'Stop because the requested task is complete.',
    inputSchema: {
        type: 'object',
        properties: { result: { type: 'string' } },
        required: ['result'],
        additionalProperties: false,
    },
    // finish 的结果会让主循环停止，不再请求下一轮模型。
    execute: input => ({ output: input, stop: true }),
}

const askUser = {
    name: 'ask_user',
    description: 'Stop and ask for information that cannot be discovered.',
    inputSchema: {
        type: 'object',
        properties: { question: { type: 'string' } },
        required: ['question'],
        additionalProperties: false,
    },
    // ask_user 同样停止循环，等待用户补充信息后再发送新消息。
    execute: input => ({ output: input, stop: true }),
}

export default [finish, askUser]
