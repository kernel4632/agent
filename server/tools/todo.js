/*
 * 任务清单工具：让模型把"打算做几步、做到哪了"写下来。
 *
 * 清单不另存一份——它就是这个工具的结果，会随会话历史一起写进磁盘，
 * 所以刷新页面、重启后端、翻历史记录，看到的都是同一份进度。
 * 调用示例：模型调用 todo({ items: [
 *   { text: '读现有实现', status: 'completed' },
 *   { text: '改 session 指令', status: 'in_progress' },
 *   { text: '补测试', status: 'pending' },
 * ] })
 */
const STATUSES = ['pending', 'in_progress', 'completed'] // 三种状态，前端按这个字段上色。

export default {
    name: 'todo',
    description: [
        'Write the task list for the current work; each item is a short sentence with a status (pending / in_progress / completed).',
        'Use this at the start of any multi-step task, and call it again whenever progress changes, so the user can see where you are.',
        'This list is for the user to track your progress — it does not perform any actions. Single trivial steps do not need a list.',
        'Send the full list every time (it replaces the previous one), marking items completed as you go.',
        'Parameters:',
        '- items (required): the complete list; each entry has text and status.',
    ].join('\n'),
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
        // 返回结构化的清单：模型下一轮能看懂，界面也能直接渲染成进度条。
        return { items: items.map(item => ({ text: item.text, status: item.status })) }
    },
}
