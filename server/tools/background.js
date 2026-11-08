/*
 * 后台进程工具：看日志、等输出、停进程。
 *
 * 启动后台进程只有一个入口：execute_command 的 background: true。这里不再提供
 * action: 'start'，否则起长任务就有两条路，模型每次都得先猜该用哪个。
 *
 * 进程表、日志文件、清理逻辑都在 utils/process.js，这里只是模型调用的入口。
 *
 * 调用示例：
 *   模型调用 background({ action: 'log', id: 'a1f2', tail: 200 })
 *   模型调用 background({ action: 'log', id: 'a1f2', waitFor: 'Listening on', waitMs: 10000 })
 *   模型调用 background({ action: 'stop', id: 'a1f2' })
 *   模型调用 background({ action: 'list' })
 */

import { readLog, list, stopProcess } from '../utils/process.js'

const background = {
    name: 'background',
    kind: 'command',
    ui: {
        view: 'command',
        icon: 'code',
        title: '后台进程',
        summary: '{id}',
        actions: [{ id: 'copy-id', label: '复制进程号', icon: 'copy', type: 'copy', value: 'id' }],
    },
    description: [
        'Inspect and control long-running processes started with execute_command({ background: true }).',
        'Three actions: log (read latest output), stop (kill it), list (show every known process).',
        'Starting a process is NOT done here — call execute_command with background: true for that.',
        'log blocks until there is new output or waitMs elapses, so you do not have to poll. Pass waitFor to wait for a specific line instead of guessing a sleep: log({ id, waitFor: "Listening on", waitMs: 10000 }) returns as soon as that pattern appears.',
        'Output streams live to a log file under the agent data directory; the process table resets when the backend restarts.',
        'Note: on Windows the command runs under cmd.exe; inline-code commands (e.g. bun -e "...") may produce no captured output — write a script file first for reliable logs.',
        'Parameters: - action (required): log | stop | list. - id (log/stop): the handle returned by execute_command.',
        '- tail (log): how many trailing lines to show, default 200, max 2000.',
        '- waitFor (log, optional): hold until output contains this text, then return. Case-insensitive literal match.',
        '- waitMs (log, optional): max time to wait for new output or waitFor, default 0 (return immediately), max 60000.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['log', 'stop', 'list'] },
            id: { type: 'string' },
            tail: { type: 'integer', minimum: 1, maximum: 2000 },
            waitFor: { type: 'string' },
            waitMs: { type: 'integer', minimum: 0, maximum: 60000 },
        },
        required: ['action'],
    },

    async execute(input, options = {}) {
        switch (input.action) {
            case 'log': return readLog(input.id, input.tail, {
                waitFor: input.waitFor,
                waitMs: input.waitMs,
                abortSignal: options.abortSignal,
            })
            case 'stop': return stopProcess(input.id)
            case 'list': return { processes: list() }
            default: throw new Error('action must be log | stop | list; to start a process use execute_command with background: true')
        }
    },
}

export default background
