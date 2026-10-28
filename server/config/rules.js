/*
 * 项目规则：从工作区自动发现 AGENTS.md 和规则目录，追加到系统提示词。
 *
 * 两种来源都认：
 *   - AGENTS.md：从工作区往上找最近的一份，和 git 找仓库根一样。
 *   - 规则目录：.agent/rules（本项目约定），另外兼容 .roo/rules（旧生态）。
 * 只在真的有规则文件时追加；没有规则时 system 保持用户原样。
 * 调用示例：
 *   await Rules.load()                                      // 启动或发消息时读一次
 *   await Rules.load({ workspace: 'D:/app' })               // 指定工作区
 *   Rules.apply({ system: '你是助手', rules: Store.rules })  // 拼成最终 system
 */

import { dirname, join, relative, resolve } from 'node:path'
import Store from '../state/store.js'

// 规则每轮都会发给模型，不能无限长。超出部分截断，不悄悄丢掉整份文件。
const MAX_BYTES = 32 * 1024
const MAX_FILES = 20

// 本项目自己的规则目录，加上旧生态的规则目录（只做兼容发现）。
const DIRS = ['.agent/rules', '.roo/rules']

// 智能体名只收合法字符，避免拼出一个跑到工作区外面的路径。
const SAFE_AGENT = /^[a-zA-Z0-9_-]+$/

/**
 * 这次要读哪些规则目录：通用目录，加上 `rules-<agent>`。
 * @param {string} [agent] 当前智能体名。
 * @returns {string[]} 相对项目根的目录列表。
 */
const dirsFor = agent => {
    const dirs = [...DIRS]
    if (typeof agent === 'string' && SAFE_AGENT.test(agent)) dirs.push(`.agent/rules-${agent}`, `.roo/rules-${agent}`)
    return dirs
}

// --- 读一个文本文件，读不到就当没有 ---
const readText = async path => {
    try {
        return await Bun.file(path).text()
    } catch {
        return ''
    }
}

/**
 * 从工作区往上找最近的 AGENTS.md。
 * @param {{ workspace: string, stopAt?: string }} target 从哪个目录开始，以及最多找到哪一层。
 * @returns {Promise<string|null>} 规则文件路径；找不到时是 null。
 */
const findAgents = async ({ workspace, stopAt }) => {
    let current = resolve(workspace)
    const limit = stopAt ? resolve(stopAt) : null
    while (true) {
        const candidate = join(current, 'AGENTS.md')
        if (await Bun.file(candidate).exists()) return candidate
        if (limit && current === limit) return null
        const parent = dirname(current)
        if (parent === current) return null
        current = parent
    }
}

/**
 * 列出规则目录里的 Markdown 文件。
 * @param {{ root: string, agent?: string }} input 项目根目录和当前智能体。
 * @returns {Promise<string[]>} 排序后的绝对路径；目录不存在时是空数组。
 */
const listRules = async ({ root, agent }) => {
    const found = []
    for (const dir of dirsFor(agent)) {
        const base = join(root, dir)
        try {
            for await (const entry of new Bun.Glob('**/*.md').scan({ cwd: base, onlyFiles: true, dot: true })) {
                found.push(join(base, entry))
            }
        } catch {
            // 目录不存在是正常情况，用户不写规则也用得。
        }
    }
    return found.sort()
}

/**
 * 把一组文件拼成一段带来源标题的规则文本。
 * @param {{ files: string[], root: string }} input 文件列表和用来计算相对路径的根目录。
 * @returns {Promise<string>} 拼好的规则正文；没有内容时是空字符串。
 */
const compose = async ({ files, root }) => {
    const sections = []
    let used = 0
    for (const file of files.slice(0, MAX_FILES)) {
        const content = (await readText(file)).trim()
        if (!content) continue

        const name = relative(root, file).replace(/\\/g, '/')
        const header = `### ${name}\n`
        const room = MAX_BYTES - used - Buffer.byteLength(header)
        if (room <= 0) break

        // 按字节截断，避免中文文件按字符算时实际体积超出上限。
        const body = Buffer.byteLength(content) > room
            ? `${Buffer.from(content).subarray(0, Math.max(0, room - 64)).toString('utf8')}\n（内容过长，已截断）`
            : content
        sections.push(`${header}${body}`)
        used += Buffer.byteLength(header) + Buffer.byteLength(body)
    }
    return sections.join('\n\n')
}

/**
 * 读工作区的全部规则。
 * @param {{ workspace?: string, stopAt?: string, agent?: string }} target 工作区、向上搜索的边界和当前智能体。
 * @returns {Promise<string>} 可以直接拼进 system 的规则文本；没有规则时是空字符串。
 */
const read = async ({ workspace = process.cwd(), stopAt, agent } = {}) => {
    const agents = await findAgents({ workspace, stopAt })
    const root = agents ? dirname(agents) : resolve(workspace)
    const files = agents ? [agents, ...await listRules({ root, agent })] : await listRules({ root, agent })
    const body = await compose({ files, root })
    if (!body) return ''
    return `# 项目规则\n\n下面这些规则来自项目文件，必须遵守。\n\n${body}`
}

/**
 * 读一次并记在内存里，供 Config.resolve 使用。
 * @param {{ workspace?: string, stopAt?: string, agent?: string, config?: object }} options 工作区、边界、智能体和当前配置。
 * @returns {Promise<string>} 本次生效的规则文本。
 */
const load = async ({ workspace = process.cwd(), stopAt, agent, config = Store.config } = {}) => {
    Store.rules = config.rules?.enabled === false ? '' : await read({ workspace, stopAt, agent })
    return Store.rules
}

/**
 * 把规则拼到用户写的系统提示词后面。
 * @param {{ system?: string, rules?: string }} input 用户提示词和规则。
 * @returns {string} 最终的 system；没有规则时原样返回用户提示词。
 */
const apply = ({ system = '', rules = '' }) => {
    if (!rules) return system
    return system ? `${system}\n\n${rules}` : rules
}

export default { read, load, apply }
