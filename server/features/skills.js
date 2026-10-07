/*
 * 技能：放在数据目录 skills/ 里的一份份操作步骤，agent 需要时自己去读。
 *
 * 每个技能是一个文件夹，里面一个 SKILL.md，开头是 name 和 description，下面是正文：
 *   skills/review-pr/SKILL.md
 *   ---
 *   name: review-pr
 *   description: 审查一个 PR 时用这个
 *   ---
 *   （下面是具体步骤）
 *
 * 为什么不全塞进系统提示词：技能正文可能几千字，全塞进去会把每个会话的上下文都撑满，
 * 而且大部分技能这一次根本用不上。所以这里只把"有哪些技能、各是干什么的"告诉模型，
 * 正文等它真的要用了再用 read 工具去读。
 * 调用示例：
 *   const skills = await Skills.list()      // [{ name, description, path }]
 *   const text = await Skills.read('review-pr')
 *   const tools = await Skills.tools()      // 只有有技能时才给出 read 工具
 */

import { mkdir } from 'node:fs/promises'
import Path from '../utils/path.js'
import fail from '../utils/fail.js' // 读一个不存在的技能时按填错处理。

// --- 拆出开头的 name 和 description ---
const parse = text => {
    // 技能文件开头是两行 --- 夹起来的小段，照着 agentskills 约定写的。
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!match) return null // 没有这段就不算技能，跳过它。

    const fields = {}
    // 这个小段里每行是「字段名: 值」，值可能很长（description 常常一整段）。
    for (const line of match[1].split('\n')) {
        const separator = line.indexOf(':')
        if (separator < 0) continue
        fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
    }
    if (!fields.name || !fields.description) return null // 缺名字或说明的技能模型没法判断该不该用。
    return { ...fields, body: text.slice(match[0].length).trim() }
}

// --- 列出全部技能 ---
const list = async () => {
    const found = []
    // 数据目录里第一次还没有 skills/，先建出来，用户放进去就会被发现。
    await mkdir(Path.skills(), { recursive: true })

    for await (const file of new Bun.Glob('*/SKILL.md').scan({ cwd: Path.skills() })) {
        const skill = parse(await Bun.file(`${Path.skills()}/${file}`).text())
        // 格式不对的文件直接跳过：技能目录是用户自己管的，坏文件不该挡住其他技能。
        if (skill) found.push({ name: skill.name, description: skill.description, body: skill.body })
    }
    return found
}

// --- 读一个技能的正文 ---
const read = async name => {
    const skill = (await list()).find(item => item.name === name)
    // 模型可能记错名字，这里要说清有哪些可选，它下一轮才知道怎么改。
    if (!skill) throw fail(404, `Skill not found: ${name}`)
    return skill.body
}

// --- 给模型一个"读技能正文"的工具 ---
const tools = async () => {
    const available = await list()
    if (!available.length) return {} // 一个技能都没有时不给工具，省得模型去调一个必然失败的东西。

    // 把技能清单塞进工具说明：模型看到的是"有哪些技能、各是干什么的"，正文等它要用时再读。
    const catalogue = available.map(item => `- ${item.name}: ${item.description}`).join('\n')
    return {
        skill: {
            name: 'skill',
            description: `Read the full instructions of one skill. Available skills:\n${catalogue}`,
            inputSchema: {
                type: 'object',
                properties: { name: { type: 'string', description: '技能名，从上面的清单里选' } },
                required: ['name'],
            },
            execute: ({ name }) => read(name),
        },
    }
}

export default { list, read, tools }
