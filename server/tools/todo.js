/*
 * 任务清单工具：让模型把"打算做几步、做到哪了"写下来。
 *
 * 名字和参数对齐 Roo Code：update_todo_list({ todos })，todos 是一整段带状态标记的清单。
 * 清单不另存一份——它就是这个工具的结果，会随会话历史一起写进磁盘，
 * 所以刷新页面、重启后端、翻历史记录，看到的都是同一份进度。
 * 调用示例：模型调用 update_todo_list({ todos: '- [x] 读现有实现\n- [-] 改 session 指令\n- [ ] 补测试' })
 */
const STATUSES = ['pending', 'in_progress', 'completed'] // 三种状态，前端按这个字段上色。

// 把 Roo 的 Markdown 清单转成结构化条目，界面和历史里的旧格式都能用。
const parseTodos = text => String(text)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
        const match = line.match(/^[-*]\s*\[(.)\]\s*(.*)$/)
        if (!match) return { text: line, status: 'pending' }
        const mark = match[1].toLowerCase()
        return {
            text: match[2],
            status: mark === 'x' ? 'completed' : mark === '-' ? 'in_progress' : 'pending',
        }
    })

export default {
    name: 'update_todo_list',
    description: [
        'Replace the entire TODO list with an updated checklist reflecting the current state of the task.',
        'Always send the full list — it replaces the previous one; do not send only the changes. Mark items completed as you go.',
        'Use this at the start of any multi-step task, and call it again whenever progress changes, so the user can see where you are.',
        'This list is for the user to track your progress — it does not perform any actions. Single trivial steps do not need a list.',
        'Format each item on its own line: "- [ ] pending", "- [-] in progress", "- [x] completed".',
        'Parameters:',
        '- todos (required): the complete checklist with status markers.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            todos: {
                type: 'string',
                description: '完整清单，每次都写全量；每行用 - [ ] / - [-] / - [x] 标状态',
            },
        },
        required: ['todos'],
    },

    // --- 记录当前进度 ---
    async execute({ todos, items }) {
        const list = Array.isArray(items)
            ? items.map(item => ({ text: item.text, status: STATUSES.includes(item.status) ? item.status : 'pending' }))
            : parseTodos(todos ?? '')
        if (!list.length) throw new Error('todos is required')

        // 同时返回结构化条目和原始文本：下一轮模型能看懂，界面也能直接渲染进度。
        return { todos: typeof todos === 'string' ? todos : '', items: list }
    },
}
