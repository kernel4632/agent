/* 两个控制工具都明确结束当前 Agent 循环。 */
const finish = {
    name: 'finish', description: 'Stop because the requested task is complete.',
    inputSchema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'], additionalProperties: false },
    execute: input => ({ output: input, stop: true }),
}
const askUser = {
    name: 'ask_user', description: 'Stop and ask for information that cannot be discovered.',
    inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'], additionalProperties: false },
    execute: input => ({ output: input, stop: true }),
}

export default [finish, askUser]
