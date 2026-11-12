/*
 * skill 扩展后端：通过 ctx.patch / ctx.op 注入技能功能，支持干净地卸载。
 *
 * 这个文件在 server.js 启动时被 Extension.load() 调用。
 * 通过 ctx 修改框架，加载器记录每一处改动，拔出扩展时逐条恢复。
 */

import store from '@agent/store.js'
import Tool from '@agent/features/tool.js'
import Skills from './skills.js'
import SkillTool from './tool.js'
import AgentCore from '@kernel4632/agent-core'

export default ctx => {
    // --- patch Tool.build：注入技能工具 ---
    ctx.patch(Tool, 'build', original => async ({ sessionId, onPermission, saveSession, mcp }) => {
        const result = await original({ sessionId, onPermission, saveSession, mcp })
        const session = store.sessions[sessionId]
        if (session) {
            const skillTool = await SkillTool.build({ cwd: session.cwd, skills: Skills })
            if (skillTool) {
                result.tools = AgentCore.tool.merge(result.tools, AgentCore.tool.adopt([skillTool]))
            }
        }
        return result
    })

    // --- patch Tool.kind：skill 工具返回 read 类别 ---
    ctx.patch(Tool, 'kind', original => ({ toolName, mcpServers }) => {
        if (toolName === 'skill') return 'read'
        return original({ toolName, mcpServers })
    })

    // --- patch Tool.list：设置页补上 skill 工具占位 ---
    ctx.patch(Tool, 'list', original => async () => {
        const tools = await original()
        if (!tools.some(t => t.name === 'skill')) {
            tools.push({
                name: 'skill',
                kind: 'read',
                kindLabel: '读取',
                kindHint: '只读文件和数据',
                permission: 'ask',
                configurable: true,
                ui: { view: 'skill', icon: 'book', title: '读取技能', summary: '{name}' }
            })
        }
        return tools
    })

    // --- 注册技能管理命令 ---
    ctx.op('skill.list',   ({ cwd } = {}) => Skills.list({ cwd: cwd || process.cwd() }))
    ctx.op('skill.read',   ({ name, cwd } = {}) => Skills.read({ name, cwd: cwd || process.cwd() }))
    ctx.op('skill.save',   body => Skills.save(body || {}))
    ctx.op('skill.remove', body => Skills.remove(body || {}))
    ctx.op('skill.toggle', body => Skills.toggle(body || {}))
    ctx.op('skill.source', body => Skills.source(body || {}))
}
