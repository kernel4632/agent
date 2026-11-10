/*
 * 模型上下文：决定这次请求带哪段系统提示词、用多大的上下文预算、支持哪些能力。
 *
 * 上下文由用户写的提示词和工作区的项目规则组成；不把工具用法塞进去——
 * 工具说明由每个工具自己提供。项目规则读会话目录里的 AGENTS.md（没有再看 CLAUDE.md），
 * 按修改时间缓存，文件变了下次装配时自动换新。压缩是另一件事，见 compact.js。
 *
 * 调用示例：
 *   const full = await Context.system({ config: store.config, cwd: 'D:/notes' })
 *   const info = Context.info({ provider: 'local', model: 'qwen3' })
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
const info = ({ provider: name, model }) => {
    const provider = (store.config.providers || []).find(item => item.name === name)
    const entry = (provider?.models || []).find(item => item?.id === model)
    if (!entry) return { context: DEFAULT_CONTEXT, capabilities: null }
    return {
        context: Number(entry.context) || DEFAULT_CONTEXT,
        capabilities: Array.isArray(entry.capabilities) ? entry.capabilities : null,
    }
}


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

// 压缩总结的固定规范：agent-core 的压缩提示词只给了保留/丢弃原则，
// 这里补上后续接手真正需要的细节结构。它只在模型收到压缩任务时生效。
const COMPACT_GUIDE = `# 上下文压缩

仅当任务是把对话压缩成供后续继续工作的上下文时，输出详细的 Markdown 交接报告；正常回答不受此节影响。

必须按顺序包含以下章节，即使某一节很短也要保留标题：

1. **目标与约束**：用户最初的目标、明确要求、边界、版本、平台，以及不能改动的东西。
2. **当前状态**：现在什么能用、什么坏了，工作区和运行服务的准确状态。
3. **已确认的事实与数据**：实际观察到的文件路径、符号、行号、命令、URL、版本、ID、数字结果和测试数量。
4. **已完成的工作**：按时间顺序列出动作和结果，以及做过的验证。
5. **代码与文件**：每个改动过或检查过的文件，写绝对路径和关键代码/改动说明。
6. **命令、测试与错误**：准确命令、失败输出、根因、修复方式，以及修复是否验证过。
7. **决策与放弃的路径**：做过的决定、否掉的方案和原因，避免下一轮重做。
8. **未完成事项与下一步**：待办、已知风险，以及最具体的下一个动作。
9. **用户原话锚点**：用户措辞重要的指令，保留简短原话。

规则：具体细节优先于概括；不得编造；区分已确认事实和推测；能解释约束的失败尝试要保留；只输出总结本身，不要寒暄或元评论。摘要通常应有 1500-3000 字，宁可保留可执行细节，也不要只写标题。`

// --- 组装发给模型的 system：用户提示词、工作区规则、压缩规范各管一段 ---
const system = async ({ config = store.config, cwd } = {}) => {
    const parts = [(config.prompt?.system || '').trim()]
    const rulesText = await rules(cwd)
    if (rulesText) parts.push(`# Workspace rules\n\nThe rules below come from the project files in the current working directory. Follow them in addition to the user's instructions.\n\n${rulesText}`)
    parts.push(COMPACT_GUIDE)
    return parts.filter(Boolean).join('\n\n')
}

export default { info, system }
