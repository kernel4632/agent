/*
 * 监控工具：模型用于挂载后台条件、查看列表或停止监控的入口。
 *
 * 遵循 la 原生工具风格（单工具 action 分发，类似 background 工具）。
 * context 中由 Tool.attach 注入 sessionId 和 cwd。
 *
 * 调用示例：
 *   模型调用 monitor({ action: 'start', condition: { kind: 'process', id: 'a1f2' }, objective: '...' })
 *   模型调用 monitor({ action: 'list' })
 *   模型调用 monitor({ action: 'stop', id: 'm1' })
 */

import MonitorEngine from './engine.js'

const tool = {
    name: 'monitor',
    kind: 'never',                             // 不需要每次弹窗审批
    ui: {
        view: 'monitor',
        icon: 'bell',
        title: '监控激活',
        summary: '{objective}',
    },
    description: [
        'Register a background condition monitor, inspect active monitors, or stop them.',
        'When the condition is met, this session is automatically woken up with a structured <goal_round> notice.',
        'Actions:',
        '- start: arm a condition. After starting, you can safely finish your response — do NOT call execute_command repeatedly to poll!',
        '- list: show all active monitors and remaining rounds.',
        '- stop: cancel a monitor by id, or cancel all.',
        'Parameters:',
        '- action (required): start | list | stop.',
        '- condition (start): { kind, ... }. Kinds: process (id, when?, waitFor?), file (path, on?, pattern?), timer (afterSeconds), command (command, intervalSeconds?, fireWhen?).',
        '- objective (start, required): the concrete goal to continue working on when woken.',
        '- name (start, optional): short human label.',
        '- rounds (start, optional): max rounds to wake (default 20).',
        '- repeat (start, optional): whether to wake repeatedly until rounds exhausted or stopped (default true).',
        '- cooldownSeconds (start, optional): cooldown between wakes (default 30).',
        '- ttlSeconds (start, optional): max time to live in seconds (default 3600).',
        '- wake (start, optional): "wake" (default, starts a new turn when idle) | "inject" (only adds to context).',
        '- key (start, optional): idempotency key to prevent duplicate monitors.',
        '- id (stop): monitor id (e.g. "m1") to stop.',
        '- all (stop, optional): boolean, stop all monitors for this session.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['start', 'list', 'stop'] },
            id: { type: 'string', description: '监控 ID (如 m1)' },
            all: { type: 'boolean', description: '是否停止当前会话全部监控' },
            condition: {
                type: 'object',
                description: '监控条件对象，必须指定 kind: process | file | timer | command',
                properties: {
                    kind: { type: 'string', enum: ['process', 'file', 'timer', 'command'] },
                    id: { type: 'string', description: '针对 process: 后台进程短 ID (如 a1f2)' },
                    when: { type: 'string', description: '针对 process: settled | exit_zero | exit_nonzero' },
                    waitFor: { type: 'string', description: '针对 process: 日志输出匹配文本' },
                    path: { type: 'string', description: '针对 file: 监视的文件路径' },
                    on: { type: 'string', enum: ['change', 'create', 'delete', 'match'] },
                    pattern: { type: 'string', description: '针对 file/command: 匹配的文本' },
                    patternMode: { type: 'string', enum: ['literal', 'regex'] },
                    afterSeconds: { type: 'integer', minimum: 1, description: '针对 timer: 等待秒数' },
                    command: { type: 'string', description: '针对 command: 执行的探测命令' },
                    intervalSeconds: { type: 'integer', minimum: 1, description: '针对 command: 轮询周期秒数' },
                    fireWhen: { type: 'string', enum: ['exit_zero', 'exit_nonzero', 'output_match'] },
                },
                required: ['kind'],
            },
            objective: { type: 'string', description: '触发唤醒后需要继续完成的目标' },
            name: { type: 'string', description: '简短标签' },
            rounds: { type: 'integer', minimum: 1, maximum: 100 },
            repeat: { type: 'boolean' },
            cooldownSeconds: { type: 'integer', minimum: 1 },
            ttlSeconds: { type: 'integer', minimum: 10 },
            wake: { type: 'string', enum: ['wake', 'inject'] },
            key: { type: 'string', description: '业务幂等 key' },
        },
        required: ['action'],
    },

    async execute(input, context = {}) {
        const sessionId = context.sessionId
        const cwd = context.cwd || process.cwd()

        if (!sessionId) throw new Error('monitor 工具必须在会话上下文中运行')

        switch (input.action) {
            case 'start': {
                const { monitor, deduped } = await MonitorEngine.arm({
                    sessionId,
                    condition: input.condition,
                    objective: input.objective,
                    name: input.name,
                    rounds: input.rounds,
                    repeat: input.repeat ?? true,
                    cooldownSeconds: input.cooldownSeconds,
                    ttlSeconds: input.ttlSeconds,
                    wake: input.wake,
                    key: input.key,
                }, { cwd })

                const tip = deduped
                  ? `已复用已有监控 [${monitor.id}]。`
                  : `已成功挂载监控 [${monitor.id}]。`

                return {
                    message: `${tip} 你现在可以放心结束本轮回复，条件达成时会自动叫醒你。不要使用 execute_command 轮询！如需手动停止，可调用 monitor({ action: 'stop', id: '${monitor.id}' })。`,
                    monitorId: monitor.id,
                    status: monitor.status,
                    deduped,
                }
            }

            case 'list': {
                const monitors = MonitorEngine.list({ sessionId, includeEnded: false })
                return {
                    count: monitors.length,
                    monitors,
                }
            }

            case 'stop': {
                const stopped = await MonitorEngine.stopMonitor({
                    sessionId,
                    id: input.id,
                    all: Boolean(input.all),
                })
                return {
                    message: stopped.length ? `已停止监控: ${stopped.join(', ')}` : '未找到符合条件的活跃监控',
                    stopped,
                }
            }

            default:
                throw new Error('action 必须是 start | list | stop 之一')
        }
    },
}

export default tool
