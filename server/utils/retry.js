/* 网络临时故障无限重试，永久错误和已经产生输出的错误立即交给调用方。 */
import pRetry from 'p-retry'
import Store from '../store.js'

const run = (operation, signal) => {
    const retry = Store.config.retry

    return pRetry(operation, {
        retries: Infinity,
        signal,
        factor: retry.factor,
        minTimeout: retry.baseDelay,
        maxTimeout: retry.maxDelay,
        shouldRetry: ({ error }) => {
            if (error?.streamed) return false

            const status = Number(error?.statusCode || error?.status || 0)
            if (status) return status === 408 || status === 429 || status >= 500

            return error instanceof TypeError && /fetch|network|socket|connection|terminated/i.test(error.message)
        },
    })
}

export default { run }
