/*
 * 会话标题：第一次聊完让模型起一个短标题，失败就保留第一句话。
 *
 * 自动标题没有开关，是默认行为。标题只用来说清楚这段对话在做什么，
 * 不需要主模型那么聪明，所以可以用 config.models.title 单独配一个小模型。
 *
 * 调用示例：
 *   const title = await Title.generate({ connection, messages })   // '修复登录跳转'
 *   const fallback = Title.fallback(messages)                      // '帮我看看这个文件'
 */

import Agent from '@kernel4632/agent-core'

// 还没有标题的会话叫这个名字；自动起标题只看它，用户手动改过就不再覆盖。
const UNTITLED = '新对话'
const MAX_LENGTH = 24

const INSTRUCTION = [
    '给下面这段对话起一个标题。',
    '要求：只输出标题本身，不要引号、不要"标题："这类前缀、不要句号。',
    '用中文，6 到 12 个字，动词开头，说清在做什么事。',
].join('\n')

// --- 把模型回的东西收拾成能直接用的标题 ---
const clean = text => {
    let title = String(text || '').split('\n').map(line => line.trim()).find(line => line) || ''
    title = title.replace(/^["'“”‘’《》【】\s]+|["'“”‘’《》【】\s]+$/g, '')
    title = title.replace(/^(?:标题|title)\s*[:：]\s*/i, '')
    title = title.replace(/[。；;.]+$/, '')
    return title.slice(0, MAX_LENGTH).trim()
}

// --- 一条消息里的纯文字 ---
const textOf = message => {
    if (typeof message?.content === 'string') return message.content
    if (!Array.isArray(message?.content)) return ''
    return message.content.filter(part => part?.type === 'text').map(part => part.text || '').join('')
}

// --- 模型起不出标题时，用用户第一句话兜底 ---
const fallback = messages => {
    const first = messages.find(message => message.role === 'user')
    const line = textOf(first).replace(/\s+/g, ' ').trim()
    if (!line) return UNTITLED
    return line.slice(0, 12)
}

// --- 让模型给这段对话起个标题 ---
const generate = async ({ connection, messages = [] }) => {
    // 只把开头几条交给它：标题取决于用户在说什么，不取决于后面聊了多久。
    const sample = messages.slice(0, 4).map(message => {
        const role = message.role === 'user' ? '用户' : '助手'
        return `${role}：${textOf(message)}`
    }).filter(line => line.length > 3).join('\n')
    if (!sample) return null

    try {
        const result = await Agent.llm.chat({
            ...connection,
            messages: [{ role: 'user', content: `${INSTRUCTION}\n\n${sample}` }],
            stream: false,
            // 标题不属于任务本身，失败就保持默认标题，不无限重试。
            retry: { shouldRetry: () => false },
        })
        return clean(result.text) || null
    } catch {
        return null
    }
}

export default { UNTITLED, MAX_LENGTH, generate, clean, fallback }
