/*
 * 技能工具：把用户放在全局目录、项目目录和已启用的外部目录里的操作说明，按需要读给模型。
 *
 * 技能来源由 utils/skills.js 统一扫描：
 *   - 全局：数据目录的 skills/（默认 %USERPROFILE%\.agents\skills）
 *   - 项目：<会话当前目录>/.agent/skills
 *   - 外部：设置页里启用的其他 Agent 软件目录
 * 同名时按“外部 → 本应用全局 → 本项目”覆盖，禁用的技能不进清单。每个技能一个文件夹，里面一份 SKILL.md：
 *   ---
 *   name: review
 *   description: 审查改动时用这个
 *   ---
 *   正文……
 *
 * 正文可能几千字，全塞进上下文会把每个会话都撑满，所以模型平时只看到清单，
 * 真要用了再调用 skill 工具读正文。
 * 调用示例：
 *   const available = await Skill.list({ cwd: 'D:/notes' })
 *   const tool = await Skill.build({ cwd: 'D:/notes' })   // 没有技能时是 null
 */

import Skills from '../utils/skills.js'

// --- 列出当前生效的技能；被用户禁用的不交给模型 ---
const list = async ({ cwd = process.cwd() } = {}) => {
    const { skills } = await Skills.list({ cwd, includeDisabled: false })
    return skills
}

// --- 读一个技能的正文 ---
const read = async ({ name, cwd = process.cwd() } = {}) => {
    const skill = await Skills.read({ name, cwd, includeDisabled: false })
    if (!skill) throw new Error(`Skill not found: ${name}`)
    return skill.body
}

// --- 造出给模型用的 skill 工具；一个技能都没有时返回 null ---
const build = async ({ cwd = process.cwd() } = {}) => {
    const available = await list({ cwd })
    if (!available.length) return null

    const catalogue = available.map(item => `- ${item.name}: ${item.description}`).join('\n')
    return {
        name: 'skill',
        kind: 'read',
        ui: {
            view: 'skill',
            icon: 'book',
            title: '读取技能',
            summary: '{name}',
        },
        description: [
            'Read the full instructions of a skill. Call this BEFORE attempting work that matches one of the skills below.',
            `Available skills:\n${catalogue}`,
            'Parameters: - name (required): the skill to read, from the list above.',
        ].join('\n'),
        inputSchema: {
            type: 'object',
            properties: { name: { type: 'string', description: 'the skill to read, from the list above' } },
            required: ['name'],
        },
        // 会话换目录后，绑定层会把新的 cwd 传进来，技能清单也跟着新目录走。
        execute: ({ name }, options = {}) => read({ name, cwd: options.cwd || cwd }),
    }
}

export default { list, read, build }
