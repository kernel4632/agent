/*
 * 模型上下文：决定这次请求带哪段系统提示词、用多大的上下文预算、支持哪些能力。
 *
 * 上下文只由用户写的提示词和当前智能体的角色说明组成；不读项目规则，
 * 也不把工具用法塞进去——工具说明由每个工具自己提供。
 * 压缩是另一件事，见 compact.js。
 *
 * 调用示例：
 *   const system = Context.system({ config: store.config, agent })
 *   const info = Context.modelInfo({ provider: 'local', model: 'qwen3' })
 *   const messages = Context.build({ history, system, tools })
 */

import Agent from '@kernel4632/agent-core'
import store from '../store.js'

const DEFAULT_CONTEXT = 128000

// 第一次使用且用户从没写过提示词时填入的默认内容。
const DEFAULT_PROMPT = `You are a general-purpose agent working inside the user's current folder.

# Working style
- Understand the request before acting. Look at the real files instead of guessing.
- Read a file before editing it. Make the smallest correct change and keep the existing style.
- Never claim a tool ran or invent its result. Wait for the real result before deciding the next step.
- Reply in the user's language unless they ask for another language.
- Do not reveal API keys or private file contents unless the user explicitly asked.

# Tool use
- Use the dedicated tools whenever they fit. Prefer reading, searching and editing tools over shell commands that do the same job.
- For a multi-step task, use update_todo_list to show the plan and update it as work progresses.
- Ask the user with ask_followup_question only when missing information blocks the task.
- When the task is complete, call attempt_completion with the final result.
- Put the complete user-facing answer in attempt_completion.result. Do not repeat it as normal assistant text.

# Objective
Work through the user's goal methodically. Each step should be informed by the previous tool result. Finish with a complete result the user can act on.`

// --- 这个模型的上下文长度和能力 ---
const modelInfo = ({ provider: name, model }) => {
    const provider = (store.config.providers || []).find(item => item.name === name)
    const entry = (provider?.models || []).find(item => (typeof item === 'string' ? item : item?.id) === model)
    if (!entry || typeof entry === 'string') return { context: DEFAULT_CONTEXT, capabilities: null }
    return {
        context: Number(entry.context) || DEFAULT_CONTEXT,
        capabilities: Array.isArray(entry.capabilities) ? entry.capabilities : null,
    }
}

// --- 最终交给模型的 system：用户写的那段提示词 ---
const system = ({ config = store.config } = {}) => (config.prompt?.system || '').trim()

// --- 把历史变成这次模型请求的 messages ---
const build = ({ history, system: prompt = '', tools = {}, budget = DEFAULT_CONTEXT, capabilities } = {}) => {
    return Agent.context.build({
        history,
        system: prompt,
        tools,
        budget,
        capabilities,
    })
}

export default { DEFAULT_CONTEXT, DEFAULT_PROMPT, modelInfo, system, build }
