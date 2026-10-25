/*
 * 任务清单状态测试：两个清单界面必须从同一张状态表取图标和文案。
 * 图标或文案只改一处时，这个测试会失败。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { TODO_STATUS, todoStatus } from '../src/session/todos.js'

test('三种任务状态各有一份图标和文案', () => {
    assert.deepEqual(TODO_STATUS, {
        completed: { icon: 'check', label: '已完成' },
        in_progress: { icon: 'clock', label: '进行中' },
        pending: { icon: 'info', label: '待处理' },
    })
    // 不认识的旧状态按待处理显示，不会渲染出空图标或空文案。
    assert.deepEqual(todoStatus('unknown'), TODO_STATUS.pending)
})

test('两个清单界面都从同一张状态表派生，没有各自复制文案', () => {
    const files = [
        '../src/session/SessionTodos.vue',
        '../src/session/tools/views/TodoView.vue',
    ]
    for (const file of files) {
        const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
        assert.match(source, /todoStatus\(status\)\.icon/, `${file} 没有从共享状态表取图标`)
        assert.match(source, /todoStatus\(status\)\.label/, `${file} 没有从共享状态表取文案`)
        assert.doesNotMatch(source, /'已完成'|'进行中'|'待处理'/, `${file} 复制了状态文案`)
    }
})
