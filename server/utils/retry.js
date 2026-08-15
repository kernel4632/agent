/* 网络临时故障无限重试，永久错误和已经产生输出的错误立即交给调用方。 */
import pRetry from 'p-retry' // 使用成熟库处理退避和 abort。
import Store from '../store.js' // 读取用户配置的退避参数。

const run = (operation, signal) => {
    const retry = Store.config.retry // 本轮重试使用当前配置快照。

    return pRetry(operation, {
        retries: Infinity, // 临时服务故障不放弃用户任务。
        signal, // stop 会立即取消等待中的退避。
        factor: retry.factor, // 每次等待按配置倍率增长。
        minTimeout: retry.baseDelay, // 使用用户设置的初始等待。
        maxTimeout: retry.maxDelay, // 等待不会超过用户设置的上限。
        shouldRetry: ({ error }) => {
            if (error?.streamed) return false // 已发出的流不能重试，避免页面看到重复内容。

            const status = Number(error?.statusCode || error?.status || 0) // 兼容常见 HTTP 错误对象。
            if (status) return status === 408 || status === 429 || status >= 500 // 仅重试超时、限流和服务端错误。

            return error instanceof TypeError && /fetch|network|socket|connection|terminated/i.test(error.message)
        },
    })
}

export default { run } // 暴露统一的异步重试入口。
