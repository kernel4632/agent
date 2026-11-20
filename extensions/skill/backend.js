/*
技能：扫描三处目录里带 SKILL.md 的文件夹，把目录注入到 onInject，模型要用全文时再调 skill 工具。
关闭名单写在 config.skills.disabled。
*/

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function homes() {
    return [join(dirname(fileURLToPath(import.meta.url)), '../../skills'), join(process.cwd(), 'skills'), join(homedir(), '.agents', 'skills'), join(process.env.AGENT_HOME || join(homedir(), '.agent'), 'skills')]
}

async function exists(path) {
    try { return (await stat(path)).isDirectory() } catch { return false }
}

async function summary(folder, name) {
    const text = await readFile(join(folder, name, 'SKILL.md'), 'utf8').catch(() => '')
    const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() || name
    const line = text.split('\n').map(item => item.trim()).find(item => item && !item.startsWith('#')) || ''
    return { name, title, description: line.slice(0, 160) }
}

export async function scan() {
    const found = new Map()
    for (const home of homes()) {
        if (!await exists(home)) continue
        for (const name of await readdir(home)) {
            if (found.has(name)) continue
            try { await stat(join(home, name, 'SKILL.md')); found.set(name, await summary(home, name)) } catch { /* 没有说明就跳过 */ }
        }
    }
    return [...found.values()]
}

export default ctx => {
    ctx.tool(join(dirname(fileURLToPath(import.meta.url)), 'tools/skill.js'))
    ctx.op('skill.list', async () => {
        const disabled = new Set((await ctx.Store.config()).skills?.disabled ?? [])
        return (await scan()).map(item => ({ ...item, enabled: !disabled.has(item.name) }))
    })
    ctx.op('skill.toggle', async ({ name, enabled }) => {
        const config = await ctx.Store.config()
        const disabled = new Set(config.skills?.disabled ?? [])
        if (enabled) disabled.delete(name)
        else disabled.add(name)
        await ctx.Store.configure({ ...config, skills: { ...config.skills, disabled: [...disabled] } })
        return ctx.Extension.invoke('skill.list', {})
    })
    ctx.patch(ctx.Agents, 'callbacks', original => id => {
        const base = original(id)
        const onInject = base.onInject
        return {
            ...base,
            async onInject(info) {
                const prior = await onInject?.(info)
                const disabled = new Set((await ctx.Store.config()).skills?.disabled ?? [])
                const items = (await scan()).filter(item => !disabled.has(item.name))
                if (!items.length) return prior
                const catalog = items.map(item => `- ${item.name}：${item.title}${item.description ? `，${item.description}` : ''}`).join('\n')
                const block = `可用技能（用 skill 工具、参数 name 读取全文）：\n${catalog}`
                return prior ? `${prior}\n\n${block}` : block
            },
        }
    })
}
