/*
按名字读取一份技能的 SKILL.md。查找顺序：工作区 skills/、~/.agents/skills、数据目录下的 skills。
*/

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'

function homes() {
    return [join(process.cwd(), 'skills'), join(homedir(), '.agents', 'skills'), join(process.env.AGENT_HOME || join(homedir(), '.agent'), 'skills')]
}

export default {
    name: 'skill',
    description: '读取一份已安装技能的完整说明。参数 name 是技能目录名，先用列表里出现过的名字。',
    parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '技能目录名' } },
        required: ['name'],
    },
    /** @param {{ name?: string }} [args] */
    async run({ name } = {}) {
        if (!name) throw new Error('name 不能为空')
        for (const home of homes()) {
            try { return { name, content: await readFile(join(home, name, 'SKILL.md'), 'utf8') } } catch { /* 试下一处 */ }
        }
        throw new Error(`找不到技能 ${name}`)
    },
}
