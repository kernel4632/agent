/* 
目标被调用形式（绝对不可修改）：
const result = await Retry.run({
    // 要重试的操作（一个返回 Promise 的函数）
    operation: () => LLM.chat({ messages, tools }),

    // 取消信号，用户点停止时触发
    signal: abortSignal,

    // 重试通知回调，UI 靠它显示"正在重试"
    onRetry: (info) => {},

    // 重试退避时间上限，默认 60 秒
    maxDelay: 60,
}) 
 */

import pRetry from 'p-retry'

// AI SDK 会标记部分错误能否重试；没有标记时才按 HTTP 状态码和网络错误判断。
const isRetryable = error => {
    if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return false
    if (typeof error?.isRetryable === 'boolean') return error.isRetryable
    if (typeof error?.statusCode === 'number') return error.statusCode === 408 || error.statusCode === 429 || error.statusCode >= 500
    return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(error?.code)
}

const run = async ({ operation, signal, onRetry, maxDelay = 60 }) => {
    if (typeof operation !== 'function') throw new TypeError('operation must be a function')
    if (!Number.isFinite(maxDelay) || maxDelay < 0) throw new TypeError('maxDelay must be a non-negative number')

    return pRetry(operation, {
        retries: Infinity, // 文件头没有最大次数参数，保持原先“可重试就持续重试”的约定。
        signal, // p-retry 会在请求之间和等待期间响应用户取消。
        minTimeout: 1000, // 第一次等待一秒，后续自动按指数增长。
        maxTimeout: maxDelay * 1000, // 文件头的秒单位转换为 p-retry 使用的毫秒。
        shouldRetry: async info => {
            const retry = isRetryable(info.error)
            if (retry) await onRetry?.({ attempt: info.attemptNumber, error: info.error, delay: info.retryDelay })
            return retry
        },
    })
}

export default { run }
