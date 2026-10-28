/*
 * 斜杠命令：把 Markdown 文件变成用户可以快速调用的提示词。
 *
 * 三个地方都认，后面的覆盖前面的：
 *   - 数据目录的 commands/                         （全局）
 *   - <工作区>/.roo/commands/                       （roo code 的写法）
 *   - <工作区>/.agent/commands/                     （本项目自己的写法）
 *
 * 文件格式：
 *   ---
 *   name: review
 *   description: 审查当前改动
 *   ---
 *   请审查当前工作区的改动，重点看……
 *
 * 正文里的 $ARGUMENTS 会换成命令后面的文字；没有这个占位符时，参数追加在最后。
 * 调用示例：
 *   const commands = await Commands.list({ workspace: 'D:/app' })
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import matter from 'gray-matter'
import Path from '../utils/path.js'

// 一次最多给这么多条，正文也截断；命令列表要发给前端，不能无限大。
const MAX_COMMANDS = 100
const MAX_PROMPT = 16 * 1024

// 命令名要能安全地写在 /name 里。
const NAME = /^[a-zA-Z0-9_-]+$/

// --- 这次要读哪几个目录 ---
const dirsFor = workspace => [
    Path.commands(),
    join(workspace, '.roo', 'commands'),
    join(workspace, '.agent', 'commands'),
]

/**
 * 扫一个目录，把命令放进 map（同名时后来的覆盖前面的）。
 * @param {string} dir 目录。
 * @param {Map<string, object>} commands 已经收集到的命令。
 * @returns {Promise<void>}
 */
const readDir = async (dir, commands) => {
    let entries
    try {
        entries = await readdir(dir, { withFileTypes: true })
    } catch {
        return // 目录不存在是正常情况。
    }

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue

        const fallback = entry.name.slice(0, -3)
        try {
            const parsed = matter(await Bun.file(join(dir, entry.name)).text())
            const name = typeof parsed.data.name === 'string' && parsed.data.name.trim() ? parsed.data.name.trim() : fallback
            if (!NAME.test(name)) continue

            const prompt = parsed.content.trim()
            if (!prompt) continue

            // 没写 description 时拿正文第一行当说明，方便用户在菜单里认出来。
            const firstLine = prompt.split('\n').find(line => line.trim())?.trim() || '自定义命令'
            const description = typeof parsed.data.description === 'string' && parsed.data.description.trim()
                ? parsed.data.description.trim()
                : firstLine.slice(0, 80)

            commands.set(name, { name, description, prompt: prompt.slice(0, MAX_PROMPT) })
        } catch {
            // 单个坏文件不影响其它命令。
        }
    }
}

/**
 * 列出可用的斜杠命令。
 * @param {{ workspace?: string }} options 工作区，默认是后端启动目录。
 * @returns {Promise<Array<{ name: string, description: string, prompt: string }>>} 按名字排序的命令。
 */
const list = async ({ workspace = process.cwd() } = {}) => {
    const commands = new Map()
    for (const dir of dirsFor(workspace)) {
        await readDir(dir, commands)
        if (commands.size >= MAX_COMMANDS) break
    }
    return [...commands.values()]
        .sort((first, second) => first.name.localeCompare(second.name))
        .slice(0, MAX_COMMANDS)
}

export default { list }
