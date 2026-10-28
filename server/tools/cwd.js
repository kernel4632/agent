/*
 * 移动目录工具：让 agent 把自己的当前位置换到另一个目录。
 *
 * 目录只是会话的一个属性，不是工作区，也不要求目录里有什么项目文件。
 * 移动之后，文件工具和命令工具都从这里算相对路径；历史不会丢。
 * 调用示例：模型调用 cwd({ path: 'D:/notes' })
 */

import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import store from '../store.js'

const move = {
    name: 'cwd',
    kind: 'other',
    ui: {
        view: 'cwd',
        icon: 'folder',
        title: '切换目录',
        summary: '{path}',
        actions: [{ id: 'copy-path', label: '复制路径', icon: 'copy', type: 'copy', value: 'path' }],
    },
    description: [
        'Move the agent current directory to another folder. The conversation history stays the same; only relative paths and command working directories change.',
        'Use an absolute path when possible. The folder must already exist.',
        'Parameters: - path (required): the folder to move to.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
    },

    async execute({ path }, options = {}) {
        const sessionId = options.sessionId
        const session = store.sessions[sessionId]
        if (!session) throw new Error(`Session not found: ${sessionId}`)

        const target = isAbsolute(path) ? path : resolve(session.cwd || process.cwd(), path)
        const info = await stat(target).catch(() => null)
        if (!info?.isDirectory()) throw new Error(`Folder not found: ${target}`)

        session.cwd = target
        session.updatedAt = Date.now()
        // 路径变化要立刻落盘；动态导入避免和历史模块形成加载环。
        const { default: History } = await import('../features/history.js')
        await History.save(sessionId)
        return `Moved to ${target}`
    },
}

export default move
