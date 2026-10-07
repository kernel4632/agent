/*
 * 技能：一份份操作步骤，agent 需要时自己去读。
 *
 * 技能有两处，和工具一样：内置的跟着代码走（server/skills/），用户自己的放在数据目录（skills/），
 * 同名时用户版覆盖内置版，改内置技能的行为不用去动代码。
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
 * 正文等它真的要用了再用 read 工具去读。工具表里那个 skill 工具就是为这个准备的。
 * 调用示例：
 *   const skills = await Skills.list()      // [{ name, description }]
 *   const text = await Skills.read('review-pr')
 *   const tools = await Skills.tools()      // 只有有技能时才给出 read 工具
 */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter' // 解析技能文件开头的 name 和 description。
import Path from '../utils/path.js'
import fail from '../utils/fail.js' // 读一个不存在的技能时按填错处理。

// 内置技能跟着代码走，换台机器、新克隆一份也都在这。
// Glob 只收字符串路径，所以这里把 URL 转成平台路径。
const builtIn = () => fileURLToPath(new URL('../skills/', import.meta.url))
// --- 拆出开头的 name 和 description ---
const parse = text => {
    // 技能文件开头是 front matter，交给 gray-matter 解析：值里有冒号、有引号、
    // 换行写成多行都能正确处理，自己按行切开遇到这些就会解析错。
    const { data, content } = matter(text)
    if (!data.name || !data.description) return null // 缺名字或说明的技能模型没法判断该不该用。
    return { name: data.name, description: data.description, body: content.trim() }
}

// --- 读一个目录里的技能 ---
const scan = async directory => {
    const found = []
    for await (const file of new Bun.Glob('*/SKILL.md').scan({ cwd: directory })) {
        const skill = parse(await Bun.file(`${directory}/${file}`).text())
        // 格式不对的文件直接跳过：技能目录是用户自己管的，坏文件不该挡住其他技能。
        if (skill) found.push({ name: skill.name, description: skill.description, body: skill.body })
    }
    return found
}

// --- 列出全部技能 ---
const list = async () => {
    // 数据目录里第一次还没有 skills/，先建出来，用户放进去就会被发现。
    await mkdir(Path.skills(), { recursive: true })

    const skills = new Map()
    // 先放内置的，再用用户的覆盖同名的，用户想改内置技能的行为不用去动代码。
    for (const skill of await scan(builtIn())) skills.set(skill.name, skill)
    for (const skill of await scan(Path.skills())) skills.set(skill.name, skill)
    return [...skills.values()]
}

// --- 读一个技能的正文 ---
const read = async name => {
    const skill = (await list()).find(item => item.name === name)
    // 模型可能记错名字，这里要说清有哪些可选，它下一轮才知道怎么改。
    if (!skill) throw fail(404, `Skill not found: ${name}`)
    return skill.body
}
/**
 * 给模型一个按需读技能正文的工具。
 * 一个技能都没有时不返回任何工具，省得模型去调一个必然失败的东西。
 * @returns {Promise<object>} 只含 skill 一个工具的 record；没有技能时是空对象。
 */
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
