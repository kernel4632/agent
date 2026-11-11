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
const _build = Tool.build
Tool.build = async ({ sessionId, onPermission, saveSession, mcp }) => {
    // 调用原始 build，拿到基础工具表
    const result = await _build({ sessionId, onPermission, saveSession, mcp })
    
    // 注入技能工具（如果当前会话有技能的话）
    const session = store.sessions[sessionId]
    if (session) {
        const skillTool = await SkillTool.build({ cwd: session.cwd, skills: Skills })
        if (skillTool) {
            // result.tools 是 { schema, handlers }，从 schema 里取出所有工具对象，加上技能工具，再 adopt
            const withSkill = AgentCore.tool.adopt([
                ...Object.values(result.tools.schema),
                skillTool,
            ])
            result.tools = withSkill
        }
    }
    
    return result
}

// --- Patch Admin.OPS：注入技能管理命令 ---
Admin.OPS['skill.list'] = ({ cwd } = {}) => Skills.list({ cwd: cwd || process.cwd() })
Admin.OPS['skill.read'] = ({ name, cwd } = {}) => Skills.read({ name, cwd: cwd || process.cwd() })
Admin.OPS['skill.save'] = body => Skills.save(body || {})
Admin.OPS['skill.remove'] = body => Skills.remove(body || {})
Admin.OPS['skill.toggle'] = body => Skills.toggle(body || {})
Admin.OPS['skill.source'] = body => Skills.source(body || {})

console.log('[extension] skill 已加载')
