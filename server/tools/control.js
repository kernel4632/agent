/* 两个控制工具都明确结束当前 Agent 循环。 */
const finish = { // 模型确认任务完成时调用。
    name: 'finish',
    description: 'Stop because the requested task is complete.',
    inputSchema: {
        type: 'object',
        properties: { result: { type: 'string' } },
        required: ['result'],
        additionalProperties: false,
    },
    // finish 的结果会让主循环停止，不再请求下一轮模型。
    execute: input => ({ output: input, stop: true }), // 把结果原样展示并停止循环。
}

const askUser = { // 模型缺少外部信息时调用。
    name: 'ask_user',
    description: 'Stop and ask for information that cannot be discovered.',
    inputSchema: {
        type: 'object',
        properties: { question: { type: 'string' } },
        required: ['question'],
        additionalProperties: false,
    },
    // ask_user 同样停止循环，等待用户补充信息后再发送新消息。
    execute: input => ({ output: input, stop: true }), // 保留问题并等待下一条用户消息。
}

export default [finish, askUser] // 一个文件导出两个控制工具。
