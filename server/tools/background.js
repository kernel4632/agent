/*
 * 后台进程工具：把一条命令放进后台跑，随时看日志、随时停。
 *
 * 长活不再阻塞对话：起 dev server、跑全量测试、挂一个监听进程，都用这个。
 * 进程表、日志文件、清理逻辑都在 utils/process.js，这里只是模型调用的入口。
 *
 * 调用示例：
 *   模型调用 background({ action: 'start', command: 'bun run dev', cwd: 'frontend' })
 *   模型调用 background({ action: 'log', id: 'a1f2', tail: 200 })
 *   模型调用 background({ action: 'stop', id: 'a1f2' })
 */

import { spawnDetached, readLog, list, stopProcess } from '../utils/process.js'

const background = {
    name: 'background',
    kind: 'command',
    ui: {
        view: 'command',
        icon: 'code',
        title: '后台进程',
        summary: '{command}',
        actions: [{ id: 'copy-command', label: '复制命令', icon: 'copy', type: 'copy', value: 'command' }],
    },
    description: [
        'Run a command in the background and get a process handle, so long jobs never block the conversation.',
        'Three actions: start (run command, return id), log (read latest output, tail lines), stop (kill it).',
        'Output streams live to a log file under the agent data directory; the process table resets when the backend restarts.',
        'Use for dev servers, full test suites, watchers, or anything that keeps running. Use execute_command when the command should finish.',
        'Note: on Windows the command runs under cmd.exe; inline-code commands (e.g. bun -e "...") may produce no captured output — write a script file first for reliable logs.',
        'Parameters: - action (required): start | log | stop | list. - command (start): the command line to run.',
        '- cwd (start): directory relative to the session current directory. - id (log/stop): the handle from start.',
        '- tail (log): how many trailing lines to show, default 200, max 2000.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['start', 'log', 'stop', 'list'] },
            command: { type: 'string' },
            cwd: { type: 'string' },
            id: { type: 'string' },
            tail: { type: 'integer', minimum: 1, maximum: 2000 },
        },
        required: ['action'],
    },

    async execute(input, options = {}) {
        switch (input.action) {
            case 'start': return spawnDetached(input, options)
            case 'log': return readLog(input.id, input.tail)
            case 'stop': return stopProcess(input.id)
            case 'list': return { processes: list() }
            default: throw new Error('action must be start | log | stop | list')
        }
    },
}

export default background
