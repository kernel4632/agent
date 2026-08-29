export default {
    name: 'echo',
    description: '返回输入内容',
    inputSchema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
    },
    async execute(input) {
        console.log(`echo:${input.value}`)
        return `done:${input.value}`
    },
}
