/*
 * 技能工具：把用户放在全局目录和项目目录里的操作说明，按需要读给模型。
 *
 * 技能有两处：
 *   - 全局：%USERPROFILE%\.agents\skills（测试用 AGENT_SKILLS 覆盖）
 *   - 项目：<会话当前目录>/.agent/skills
 * 同名时项目版覆盖全局版。每个技能一个文件夹，里面一份 SKILL.md：
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

import matter from 'gray-matter'
import Path from '../utils/path.js'
import fail from '../utils/fail.js'

// --- 读一个目录里的技能；目录不存在时当作没有技能 ---
const scan = async directory => {
    const found = []
    try {
        for await (const file of new Bun.Glob('*/SKILL.md').scan({ cwd: directory })) {
            const text = await Bun.file(`${directory}/${file}`).text()
            const { data, content } = matter(text)
            // 缺名字或说明的技能模型没法判断该不该用，直接跳过，坏文件不挡住别的技能。
            if (!data.name || !data.description) continue
            found.push({ name: data.name, description: data.description, body: content.trim() })
        }
    } catch {
        // 用户还没建过技能目录，属于正常情况。
    }
    return found
}

// --- 列出全部技能：先放全局，再用项目里的覆盖同名项 ---
const list = async ({ cwd = process.cwd() } = {}) => {
    const skills = new Map()
    for (const skill of await scan(Path.skills())) skills.set(skill.name, skill)
    for (const skill of await scan(Path.projectSkills(cwd))) skills.set(skill.name, skill)
    return [...skills.values()]
}

// --- 读一个技能的正文 ---
const read = async ({ name, cwd = process.cwd() } = {}) => {
    const skill = (await list({ cwd })).find(item => item.name === name)
    if (!skill) throw fail(404, `Skill not found: ${name}`)
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
