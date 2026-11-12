/*
 * monitor 扩展后端入口：通过 ctx.patch 将 monitor 工具注入 Tool 模块，并启动后台调度引擎。
 *
 * 在 server.js 启动时被 Extension.load() 调用。
 * 停用或重载时，通过 ctx.onDispose 安全停止后台心跳。
 *
 * 调用示例：
 *   // 由 server/features/extension.js 自动加载：
 *   await Extension.load(Admin.OPS)
 */

import tool from './tool.js'
import MonitorEngine from './engine.js'
import Tool from '@agent/features/tool.js'
export default ctx => {
    // --- 启动监控后台轮询调度器 ---
    MonitorEngine.start()

    // --- patch Tool.build：向每条会话注入 monitor 工具 ---
    ctx.patch(Tool, 'build', original => async args => {
        const result = await original(args)

        // 每次会话启动装配时，预热恢复该会话历史保存的监控项
        if (args.sessionId) {
            await MonitorEngine.loadSession(args.sessionId)
        }

        // 将 monitor 工具并入会话工具集
        result.tools = Tool.merge(result.tools, Tool.adopt([tool]))
        return result
    })

    // --- patch Tool.kind：monitor 工具属于 never 类别，无需弹窗审批 ---
    ctx.patch(Tool, 'kind', original => args => {
        if (args.toolName === 'monitor') return 'never'
        return original(args)
    })

    // --- patch Tool.list：在设置页/工具清单中补齐 monitor 的元数据 ---
    ctx.patch(Tool, 'list', original => async () => {
        const tools = await original()
        if (!tools.some(t => t.name === 'monitor')) {
            tools.push({
                name: 'monitor',
                kind: 'never',
                kindLabel: '自动',
                kindHint: '挂载后台监控与条件唤醒',
                permission: 'allow',
                configurable: false,
                ui: { view: 'monitor', icon: 'bell', title: '监控激活', summary: '后台唤醒' },
            })
        }
        return tools
    })

    // --- 注册管理总线动作（供前端或调试调用） ---
    ctx.op('monitor.list', ({ sessionId } = {}) => ({
        monitors: MonitorEngine.list({ sessionId, includeEnded: true }),
    }))
    ctx.op('monitor.stop', ({ sessionId, id, all } = {}) => MonitorEngine.stopMonitor({ sessionId, id, all }))

    // --- 扩展拔出/停用时：清理调度器 ---
    ctx.onDispose(() => {
        MonitorEngine.stop()
    })
}
