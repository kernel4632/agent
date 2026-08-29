export default {
    name: 'stream',
    description: '返回流式内容',
    inputSchema: { type: 'object', properties: {} },
    async *execute() {
        yield 'part-1'
        yield 'part-2'
    },
}
