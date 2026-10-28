/*
 * 长文本截断：工具输出太长时只留头和尾。
 *
 * 哪个工具要截、截多长，由工具自己决定；这里只提供那把剪刀。
 * 调用示例：
 *   truncate(text)                  // 超过 6000 字符时保留头尾
 *   truncate(text, { limit: 8000 }) // 换一个上限
 */

const DEFAULT_LIMIT = 6000

const truncate = (text, { limit = DEFAULT_LIMIT } = {}) => {
    if (text.length <= limit) return text

    // 头和尾各留一半：开头通常是回显和第一处错误，结尾是最终结果和退出信息。
    const half = Math.floor(limit / 2)
    const dropped = text.length - half * 2
    return `${text.slice(0, half)}\n\n...（中间省略 ${dropped} 个字符）...\n\n${text.slice(-half)}`
}

export { truncate }
