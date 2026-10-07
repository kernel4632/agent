/*
 * 工具输出截断：命令和搜索的输出太长时，只把头和尾交给模型。
 *
 * 这是工具目录里的共享代码，本身不是工具（没有 name 和 execute），扫描时会自动跳过。
 * 调用示例：
 *   truncate(text)                      // 超过上限时返回头和尾拼起来的文本
 *   truncate(text, { limit: 8000 })     // 改上限
 */

// 默认上限：大约 6000 个字符，够模型判断情况，又不会一次塞满上下文。
const DEFAULT_LIMIT = 6000

// --- 长文本只留头尾 ---
const truncate = (text, { limit = DEFAULT_LIMIT } = {}) => {
    if (text.length <= limit) return text // 没超上限就原样给模型。

    // 头和尾各留一半：开头通常是命令回显和第一处错误，结尾是最终结果和退出信息。
    const half = Math.floor(limit / 2)
    const dropped = text.length - half * 2
    return `${text.slice(0, half)}\n\n...（中间省略 ${dropped} 个字符）...\n\n${text.slice(-half)}`
}

export { truncate }
