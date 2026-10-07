/*
 * 任务清单工具：让模型把"打算做几步、做到哪了"写下来。
 *
 * 清单只返回给模型和前端，不写磁盘——它属于这一轮任务的进度，不是用户数据。
 * 调用示例：模型调用 todo({ items: [
 *   { text: '读现有实现', status: 'completed' },
 *   { text: '改 session 指令', status: 'in_progress' },
 *   { text: '补测试', status: 'pending' },
 * ] })
 */
const STATUSES = ['pending', 'in_progress', 'completed'] // 三种状态，前端按这个字段上色。

export default {
    name: 'todo',
    description: 'Write the task list for the current work. Call it again whenever progress changes so the user can see where you are.',
    inputSchema: {
        type: 'object',
        properties: {
            items: {
                type: 'array',
                description: '完整清单，每次都写全量，不是只写变化',
                items: {
                    type: 'object',
                    properties: {
                        text: { type: 'string' },
                        status: { type: 'string', enum: STATUSES },
                    },
                    required: ['text', 'status'],
                },
            },
        },
        required: ['items'],
    },

    // --- 记录当前进度 ---
    async execute({ items }) {
        // 清单本身就是要给模型看的，原样返回，它下一轮就能看到自己上次写到哪。
        return items.map(item => `[${item.status}] ${item.text}`).join('\n')
    },
}
