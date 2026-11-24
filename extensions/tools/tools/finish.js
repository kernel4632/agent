/*
收尾工具：模型认为这轮已经说完时调用，循环以 tool-stop 结束，
不必再空跑到连续几轮不调工具才停。
*/

export default {
    name: 'finish',
    description: [
        '在你已经完成用户的请求、给出最终答复之后调用，用来结束这一轮。',
        '不要在还要读写文件、执行命令或查阅资料时调用。',
        'Parameters: summary（可选）用一两句话写下这一轮的结论。',
    ].join('\n'),
    parameters: {
        type: 'object',
        properties: { summary: { type: 'string', description: '这一轮的简短结论' } },
    },
    /** @param {{ summary?: string }} [args] */
    async run({ summary } = {}) {
        return { output: summary || '已完成', stop: true }
    },
}
