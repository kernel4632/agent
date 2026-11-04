/*
 * 模型上下文：决定这次请求带哪段系统提示词、用多大的上下文预算、支持哪些能力。
 *
 * 上下文由用户写的提示词和工作区的项目规则组成；不把工具用法塞进去——
 * 工具说明由每个工具自己提供。项目规则读会话目录里的 AGENTS.md（没有再看 CLAUDE.md），
 * 按修改时间缓存，文件变了下次装配时自动换新。压缩是另一件事，见 compact.js。
 *
 * 调用示例：
 *   const system = Context.system({ config: store.config })
 *   const full = await Context.systemFor({ config: store.config, cwd: 'D:/notes' })
 *   const info = Context.modelInfo({ provider: 'local', model: 'qwen3' })
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import store from '../store.js'

const DEFAULT_CONTEXT = 128000

// 项目规则文件太长时不把上下文徧满，只取最前面的部分。
const MAX_RULES = 20000

// --- 读一个目录里的项目规则；两个都没有时返回 null ---
const readRules = async cwd => {
    if (!cwd) return null
    for (const name of ['AGENTS.md', 'AGENTS.txt', 'CLAUDE.md']) {
        const path = join(cwd, name)
        try {
            const info = await stat(path)
            const text = (await readFile(path, 'utf8')).trim()
            if (!text) continue
            return { path, mtimeMs: info.mtimeMs, text: text.length > MAX_RULES ? text.slice(0, MAX_RULES) : text }
            
        } catch {
            // 这个目录没有项目规则，属于正常情况。
        }
    }
    return null
}

// --- 这个模型的上下文长度和能力 ---
const modelInfo = ({ provider: name, model }) => {
    const provider = (store.config.providers || []).find(item => item.name === name)
    const entry = (provider?.models || []).find(item => item?.id === model)
    if (!entry) return { context: DEFAULT_CONTEXT, capabilities: null }
    return {
        context: Number(entry.context) || DEFAULT_CONTEXT,
        capabilities: Array.isArray(entry.capabilities) ? entry.capabilities : null,
    }
}

// --- 最终交给模型的 system：用户写的那段提示词 ---
const system = ({ config = store.config } = {}) => (config.prompt?.system || '').trim()

// 项目规则的读取缓存：key 是目录，value 是 { mtimeMs, text }；文件变了自动换新。
const rulesCache = new Map()

// --- 读会话目录里的项目规则，带缓存；文件变了或换了目录就重新读 ---
const rules = async cwd => {
    const fresh = await readRules(cwd)
    if (!fresh) {
        rulesCache.delete(cwd)
        return null
    }
    const cached = rulesCache.get(cwd)
    if (cached?.mtimeMs === fresh.mtimeMs) return cached.text
    rulesCache.set(cwd, { mtimeMs: fresh.mtimeMs, text: fresh.text })
    return fresh.text
}

// --- 组装发给模型的 system：用户提示词在前，工作区规则在后 ---
const systemFor = async ({ config = store.config, cwd } = {}) => {
    const parts = [system({ config })]
    const rulesText = await rules(cwd)
    if (rulesText) parts.push(`# Workspace rules\n\nThe rules below come from the project files in the current working directory. Follow them in addition to the user's instructions.\n\n${rulesText}`)
    return parts.filter(Boolean).join('\n\n')
}

export default { DEFAULT_CONTEXT, modelInfo, system, systemFor }
