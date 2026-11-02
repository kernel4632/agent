/*
 * 任务清单状态测试：独立任务面板从工具结果推导进度。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TODO_STATUS, todoStatus, latestTodos } from '../src/commands/tool.js'

test('三种任务状态各有一份图标和文案', () => {
    assert.deepEqual(TODO_STATUS, {
        completed: { icon: 'check', label: '已完成' },
        in_progress: { icon: 'clock', label: '进行中' },
        pending: { icon: 'info', label: '待处理' },
    })
    // 不认识的旧状态按待处理显示，不会渲染出空图标或空文案。
    assert.deepEqual(todoStatus('unknown'), TODO_STATUS.pending)
})

test('任务面板取最近的清单，忽略其他工具中形似清单的内容', () => {
    const older = [{ text: '旧任务', status: 'pending' }]
    const current = [{ text: '新任务', status: 'completed' }]
    const call = (name, items) => ({ name, output: { type: 'json', value: { items } } })
    assert.deepEqual(latestTodos([
        { tools: [call('update_todo_list', older)] },
        { tools: [call('update_todo_list', current), call('another_tool', older)] },
    ]), current)
    assert.deepEqual(latestTodos([{ tools: [call('another_tool', older)] }]), [])
})
