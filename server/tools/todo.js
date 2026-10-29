/*
 * 任务清单工具：让模型把"打算做几步、做到哪了"写下来。
 *
 * 清单不另存一份——它就是这个工具的结果，会随会话历史一起写进磁盘。
 * 刷新页面、重启后端、翻历史记录，看到的都是同一份进度。
 * 调用示例：模型调用 update_todo_list({ todos: '- [x] 读现有实现\n- [-] 改代码' })
 */

const STATUSES = ['pending', 'in_progress', 'completed']

// 把 Markdown 清单转成结构化条目。
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

const todo = {
    name: 'update_todo_list',
    kind: 'never',
    ui: {
        view: 'todo',
        icon: 'check',
        title: '任务清单',
        summary: '当前进度',
    },
    description: [
        'Replace the entire TODO list with an updated checklist reflecting the current state of the task.',
        'Always send the full list — it replaces the previous one. Mark items completed as you go.',
        'Format each item on its own line: "- [ ] pending", "- [-] in progress", "- [x] completed".',
        'Parameters: - todos (required): the complete checklist with status markers.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            todos: { type: 'string', description: '完整清单，每次都写全量；每行用 - [ ] / - [-] / - [x] 标状态' },
        },
        required: ['todos'],
    },

    async execute({ todos, items }) {
        const list = Array.isArray(items)
            ? items.map(item => ({ text: item.text, status: STATUSES.includes(item.status) ? item.status : 'pending' }))
            : parseTodos(todos ?? '')
        if (!list.length) throw new Error('todos is required')
        return { todos: typeof todos === 'string' ? todos : '', items: list }
    },
}

export default todo
