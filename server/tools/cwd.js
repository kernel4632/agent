/*
 * 移动目录工具：让 agent 把自己的当前位置换到另一个目录。
 *
 * 目录只是会话的一个属性，不是工作区，也不要求目录里有什么项目文件。
 * 移动之后，文件工具和命令工具都从这里算相对路径；历史不会丢。
 * 保存会话的 saveSession 由工具宿主通过运行时 context 注入，本文件不 import features/。
 * 调用示例：
 *   cwd({ path: 'D:/notes' })   // 模型只传 input；宿主会补上 sessionId、cwd 和 saveSession
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
        const sessionId = options.sessionId                                 // 宿主注入的会话编号
        const session = store.sessions[sessionId]
        if (!session) throw new Error(`Session not found: ${sessionId}`)

        const target = isAbsolute(path) ? path : resolve(session.cwd || process.cwd(), path) // 相对路径按移动前的目录算
        const info = await stat(target).catch(() => null)                   // 目标必须已经存在
        if (!info?.isDirectory()) throw new Error(`Folder not found: ${target}`)

        session.cwd = target                                                // 只改会话自己的位置
        session.updatedAt = Date.now()                                      // 记下这次改动的时间
        await options.saveSession()                                         // 宿主注入的保存能力：路径变化立刻落盘
        return `Moved to ${target}`
    },
}

export default move
