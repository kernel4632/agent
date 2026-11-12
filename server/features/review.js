/*
 * 工具调用 AI 审核：权限规则要求 review 时，先让审核模型判断这次调用能不能执行。
 *
 * 审核器只做判断，不执行工具，也不改权限规则。模型返回 allow / deny / ask；
 * 任何失败（未启用、没有模型、超时、网络错误、JSON 不合法）都按 ask 交回审批关口，
 * 由 Approval 决定是继续问用户还是拒绝，绝不静默放行。
 * 审核模型用 config.models.review；不配就和默认模型共用。
 *
 * 调用示例：
 *   Review.bind({ agent: Agent })                        // 命令层启动时注入
 *   const verdict = await Review.check({ sessionId, toolName: 'execute_command', input: { command: 'rm -rf /' }, signal })
 *   // verdict: { decision: 'allow' | 'deny' | 'ask', reason: '...' }
 */

import AgentCore from '@kernel4632/agent-core'
import store from '../store.js'

// 审核模型和会话上下文由命令层注入；本文件不 import 别的 feature。
let services = { chat: options => AgentCore.llm.chat(options) }
const bind = value => { services = { ...services, ...value } }

// 留空时使用这份内置策略。用户在设置页写自己的策略后整段替换。
export const DEFAULT_POLICY = [
    '你是编码助手的工具调用审核员。判断下面这次工具调用是否应该执行。',
    '',
    '规则：',
    '- 只读、搜索、列目录，且目标在当前工作目录内：允许。',
    '- 修改文件或执行命令时，只有参数明确、范围有限、可以回退，并且与用户当前请求一致才允许。',
    '- 删除、覆盖、重置、提权、访问凭据或密钥、读取工作目录之外、把数据发送到外部、明显偏离用户请求：拒绝。',
    '- 无法判断意图、目标或影响范围时，选择 ask，交给用户决定。',
].join('\n')

const MAX_REQUEST = 2000
const MAX_CONTEXT = 8000
const MAX_REASON = 300
const DEFAULT_TIMEOUT = 15000
const MIN_TIMEOUT = 1000
const MAX_TIMEOUT = 120000

// --- 一条消息里的纯文字 ---
const textOf = message => {
    if (typeof message?.content === 'string') return message.content
    if (!Array.isArray(message?.content)) return ''
    return message.content.filter(part => part?.type === 'text').map(part => part.text || '').join('')
}

// --- 用户最后说了什么：审核写入/执行类调用时，这是判断“是否符合请求”的关键 ---
const lastRequest = sessionId => {
    const messages = store.sessions[sessionId]?.history?.messages || []
    const last = [...messages].reverse().find(record => record?.message?.role === 'user')
    return textOf(last?.message).replace(/\s+/g, ' ').trim().slice(0, MAX_REQUEST)
}

// --- 交给审核模型的最小上下文，不把整段会话历史发出去 ---
const contextOf = ({ sessionId, toolName, input }) => ({
    tool: toolName,
    input,
    cwd: store.sessions[sessionId]?.cwd || '',
    request: lastRequest(sessionId),
})

const policy = () => {
    const custom = store.config.review?.policy
    return typeof custom === 'string' && custom.trim() ? custom.trim() : DEFAULT_POLICY
}

const timeout = () => {
    const value = Number(store.config.review?.timeout)
    if (!Number.isFinite(value)) return DEFAULT_TIMEOUT
    return Math.min(MAX_TIMEOUT, Math.max(MIN_TIMEOUT, value))
}

// --- 模型可能带 Markdown 代码块或前后闲聊，只取最外层 JSON 对象 ---
const parse = text => {
    const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
        return JSON.parse(raw.slice(start, end + 1))
    } catch {
        return null
    }
}

const decisionOf = value => value === 'allow' || value === 'deny' || value === 'ask' ? value : 'ask'

/**
 * 审核一次工具调用。
 * @param {{ sessionId?: string, toolName: string, input?: object, signal?: AbortSignal }} call 这次工具调用。
 * @returns {Promise<{ decision: 'allow' | 'deny' | 'ask', reason: string }>} 审核结论；失败一律 ask。
 */
const check = async ({ sessionId, toolName, input = {}, signal }) => {
    if (store.config.review?.enabled !== true) return { decision: 'ask', reason: '未启用 AI 审核' }

    const target = services.agent?.model('review')
    if (!target?.provider || !target?.model) return { decision: 'ask', reason: '没有可用的审核模型' }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('审核超时')), timeout())
    const abort = () => controller.abort(signal?.reason)
    if (signal?.aborted) abort()
    signal?.addEventListener('abort', abort, { once: true })

    try {
        const context = JSON.stringify(contextOf({ sessionId, toolName, input }), null, 2)
        // 工具参数可能很长（比如整份文件）；截断后让模型按不确定处理，不把审核请求撑爆。
        const clipped = context.length > MAX_CONTEXT ? `${context.slice(0, MAX_CONTEXT)}\n...（参数过长，已截断）` : context
        const result = await services.chat({
            ...services.agent.connection(target),
            messages: [
                { role: 'system', content: `${policy()}\n\n只输出 JSON：{"decision":"allow|deny|ask","reason":"一句中文原因"}` },
                { role: 'user', content: `审核这次工具调用：\n${clipped}` },
            ],
            stream: false,
            signal: controller.signal,
            // 审核不是用户任务本身，失败就交回人工，不无限重试。
            retry: { shouldRetry: () => false },
        })
        const parsed = parse(result?.text)
        if (!parsed) return { decision: 'ask', reason: '审核结果不是有效 JSON' }
        const reason = typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, MAX_REASON) : ''
        return { decision: decisionOf(parsed.decision), reason }
    } catch (error) {
        if (controller.signal.aborted) return { decision: 'ask', reason: '审核超时或已取消' }
        return { decision: 'ask', reason: `审核失败：${String(error.message).slice(0, 200)}` }
    } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
    }
}

export default { DEFAULT_POLICY, bind, check }
