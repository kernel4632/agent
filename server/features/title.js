/*
 * 会话标题：拿用户第一句话让模型起一个短标题。
 *
 * 为什么要有它：之前是前端把第一句话截前 32 个字当标题，出来的常常不像标题
 * （"帮我看看这个文件为什么"），而且换个客户端就没有标题了。这里挪到后端，
 * 真的用模型生成，改一次标题之后就不再改。
 *
 * 用的是 Agent.llm.chat 而不是 Agent.create：
 *   标题生成不需要工具、不需要历史、不需要循环，起一个 Agent 只为问一句话太重。
 *   Agent.llm.chat 就是"和模型说一句话拿回答"，正好是这个用途。
 *
 * 调用示例：
 *   const title = await Title.generate({ connection, messages })   // '修复登录跳转'
 *   // 生成不出来时返回 null，调用方保持原标题不动
 */

import Agent from '@kernel4632/agent-core'

// 标题要短，模型被要求只回标题本身。字数上限在这里，不是让模型自己数。
const MAX_LENGTH = 24

/*
 * 给模型的指令。刻意写得死板：
 *   - 只说"输出标题本身"，因为模型很爱加"标题："前缀和引号
 *   - 明确写中文，否则英文对话会得到英文标题，而界面全是中文
 *   - 要求动词开头，这样标题像一件事而不是一个名词堆
 * 这是唯一一处为了让模型好好干活而写的文字，不涉及主对话的 system（那边始终是空的）。
 */
const INSTRUCTION = [
    '给下面这段对话起一个标题。',
    '要求：只输出标题本身，不要引号、不要"标题："这类前缀、不要句号。',
    '用中文，6 到 12 个字，动词开头，说清在做什么事。',
].join('\n')

/**
 * 把模型回的东西收拾成一个能直接用的标题。
 *
 * 模型不会老老实实只回标题，常见的多余东西都在这里去掉：
 * 引号、"标题："前缀、句末的句号、以及偶尔附带的解释行。
 * @param {string} text 模型的原始回复。
 * @returns {string} 干净的标题；实在没有可用内容时是空串。
 */
const clean = text => {
    // 先只取第一行：模型经常在标题后面另起一行解释。
    let title = String(text || '').split('\n').map(line => line.trim()).find(line => line) || ''
    // 去掉各种引号和书名号——它们都是模型自带的包装，不是标题的一部分。
    title = title.replace(/^["'“”‘’《》【】\s]+|["'“”‘’《》【】\s]+$/g, '')
    // 去掉"标题："这类前缀。
    title = title.replace(/^(?:标题|title)\s*[:：]\s*/i, '')
    // 去掉句末的句号和分号。
    title = title.replace(/[。；;.]+$/, '')
    // 还是太长就硬截，总不能把一整段话塞进侧边栏。
    return title.slice(0, MAX_LENGTH).trim()
}

/**
 * 让模型给这段对话起个标题。
 * @param {{ connection: object, messages: unknown[] }} input
 *   connection 是 Config.connection(...) 的产物（已经定好哪个模型）；
 *   messages 是会话历史，这里只取前几条用作参考。
 * @returns {Promise<string|null>} 标题；模型不可用或回不出东西时是 null。
 */
const generate = async ({ connection, messages = [] }) => {
    // 只把开头几条交给它：标题取决于用户在说什么，不取决于后面聊了多久。
    // 全交过去的话，一轮长对话会白花一大笔输入 token 就为了起个标题。
    const sample = messages.slice(0, 4).map(message => {
        const role = message.role === 'user' ? '用户' : '助手'
        return `${role}：${textOf(message)}`
    }).filter(line => line.length > 3).join('\n')
    // 一条能看的对话都没有时不起标题，省一次请求。
    if (!sample) return null

    try {
        const result = await Agent.llm.chat({
            ...connection,
            messages: [{ role: 'user', content: `${INSTRUCTION}\n\n${sample}` }],
            stream: false, // 起标题不需要边生成边看。
            /*
             * 主任务的重试策略照 agent-core 默认走（无限重试直到人工停止）——那是给
             * "模型要一直干活"设计的，主任务用它是对的。但起标题是我们应用顺手加的小事，
             * 不属于任务本身：服务挂了时用户这一轮早就结束了，没有人来停它。
             * 所以这一笔单独关掉重试，失败就保持"新对话"，用户下一轮照常干活。
             */
            retry: { shouldRetry: () => false },
        })
        return clean(result.text) || null
    } catch {
        /*
         * 起标题失败不该影响用户干活——模型连不上、密钥过期这些时候，
         * 主对话本来就会各自报错，这里再抛一次只会多一条看不懂的红字。
         * 返回 null，调用方保持原有的"新对话"。
         */
        return null
    }
}

/*
 * 把一条消息取成纯文字。
 * 消息可能是字符串，也可能是一组内容块（文字、图片、工具结果），
 * 这里只要文字，别的（尤其是图片）不参与起标题。
 */
const textOf = message => {
    const content = message.content
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content.filter(part => part?.type === 'text').map(part => part.text || '').join('')
}

export default { generate, clean, MAX_LENGTH }
