/* 无限重试临时故障，永久错误直接交给调用方。 */
import pRetry from 'p-retry'
import Store from '../store.js'

const run = (operation, signal) => pRetry(operation, {
    retries: Infinity,
    signal,
    factor: Store.config.retry.factor,
    minTimeout: Store.config.retry.baseDelay,
    maxTimeout: Store.config.retry.maxDelay,
    shouldRetry: ({ error }) => {
        if (error?.streamed) return false
        const status = Number(error?.statusCode || error?.status || 0)
        if (status) return status === 408 || status === 429 || status >= 500
        return error instanceof TypeError && /fetch|network|socket|connection|terminated/i.test(error.message)
    },
})

export default { run }
