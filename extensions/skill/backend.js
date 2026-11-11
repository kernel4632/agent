/*
 * Skill 扩展后端：patch 框架模块，注入技能工具和管理命令。
 *
 * 这个文件在 server.js 启动时被 Extension.load() import。
 * 它直接 import 框架模块并 patch 它们的导出方法。
 */

import store from '@agent/store.js'
import Tool from '@agent/features/tool.js'
import Admin from '@agent/commands/admin.js'
import Skills from './skills.js'
import SkillTool from './tool.js'
import AgentCore from '@kernel4632/agent-core'

// --- Patch Tool.build：注入技能工具 ---
const _buildTool = Tool.build
Tool.build = async ({ sessionId, onPermission, saveSession, mcp }) => {
    const result = await _buildTool({ sessionId, onPermission, saveSession, mcp })
    
    const session = store.sessions[sessionId]
    if (session) {
        const skillTool = await SkillTool.build({ cwd: session.cwd, skills: Skills })
        if (skillTool) {
            // 用 agent-core 的 merge 合并工具表，而不是直接 adopt 覆盖
            result.tools = AgentCore.tool.merge(result.tools, AgentCore.tool.adopt([skillTool]))
        }
    }
    
    return result
}

// --- Patch Tool.kind：skill 工具返回 read 类别 ---
const _kindTool = Tool.kind
Tool.kind = ({ toolName, mcpServers }) => {
    if (toolName === 'skill') return 'read'
    return _kindTool({ toolName, mcpServers })
}

// --- Patch Tool.list：设置页工具列表补上 skill ---
const _listTool = Tool.list
Tool.list = async () => {
    const tools = await _listTool()
    // 如果框架扫描没有 skill，就加一个占位，让设置页显示技能工具
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
}

// --- Patch Admin.OPS：注入技能管理命令 ---
Admin.OPS['skill.list'] = ({ cwd } = {}) => Skills.list({ cwd: cwd || process.cwd() })
Admin.OPS['skill.read'] = ({ name, cwd } = {}) => Skills.read({ name, cwd: cwd || process.cwd() })
Admin.OPS['skill.save'] = body => Skills.save(body || {})
Admin.OPS['skill.remove'] = body => Skills.remove(body || {})
Admin.OPS['skill.toggle'] = body => Skills.toggle(body || {})
Admin.OPS['skill.source'] = body => Skills.source(body || {})

// --- 返回已加载的扩展列表 ---
Admin.OPS['extension.list'] = () => Extension.state()

console.log('[extension] skill 已加载')
