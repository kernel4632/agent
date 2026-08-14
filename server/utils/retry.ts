import pRetry from 'p-retry'
import Error from './error.ts'
import type { ConfigData } from '../types.ts'

const run = <T>(operation: () => Promise<T>, config: ConfigData['retry'], signal?: AbortSignal) => pRetry(async () => {
    try { return await operation() } catch (error) {
        if (error instanceof TypeError && Error.retryable(error)) throw Object.assign(new globalThis.Error(error.message), { cause: error, isRetryable: true })
        throw error
    }
}, {
    retries: Infinity, signal, factor: config.factor, minTimeout: config.baseDelay, maxTimeout: config.maxDelay,
    shouldRetry: ({ error }) => Error.retryable(error),
})

export default { run }
