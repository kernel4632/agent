/*
 * 文本小工具：长输出截断、形状校验、常量列表归一。
 *
 * 这些函数在 tools/file.js、tools/shell.js、features/discover.js、
 * features/skills.js、features/config.js 里各写过一份，行为一致但字面不同。
 * 收在一处之后，截断策略或校验口径要改时只改这里。
 *
 * 调用示例：
 *   truncate(text)                         // 默认 6000 字，保留头尾
 *   truncate(text, 120000)
 *   isObject(value)
 *   textList(value)                        // ['a', 'b']，过滤非字符串
 */

// 默认上限和其它工具的输出同量级：一个 1MB 的页面就是三十万 token，
// 能一次性吃掉整个上下文窗口。
const DEFAULT_LIMIT = 6000

/**
 * 长文本只保留头尾，中间用一句话说明省略了多少。
 * 保留头尾而不是只留开头：错误信息通常在末尾，只留开头会把最要紧的那段丢掉。
 */
const truncate = (text, limit = DEFAULT_LIMIT) => {
    if (text.length <= limit) return text
    const half = Math.floor(limit / 2)
    return `${text.slice(0, half)}\n\n...（中间省略 ${text.length - half * 2} 个字符）...\n\n${text.slice(-half)}`
}

// --- 是一个普通对象（不是 null、不是数组） ---
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

// --- 只保留字符串项，去掉首尾空白和空串 ---
const textList = value => Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
    : []

// --- 字符串数组，不过滤空白（保留调用方原样给的空串语义） ---
const stringList = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : []

// --- 把可能脏的数字压成可信的非负整数；不可信时返回 fallback ---
// 供应商返回的 token 数可能是 null、字符串、负数甚至累计值，不拦住会污染统计。
const safeCount = (value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) => {
    const number = Number(value)
    if (!Number.isFinite(number) || number < min || number > max) return fallback
    return Math.round(number)
}

export { truncate, isObject, textList, stringList, safeCount, DEFAULT_LIMIT }
export default { truncate, isObject, textList, stringList, safeCount }
