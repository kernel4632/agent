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
import store, { DEFAULT_PROMPT } from '../store.js'

const DEFAULT_CONTEXT = 128000

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
