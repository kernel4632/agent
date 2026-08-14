/*
无限退避执行器：可恢复错误会一直重试，每次等待最多不超过配置上限。
调用方决定哪些错误可恢复；AbortSignal 是唯一能打断无限等待的方式。
*/
import Store from '../store.ts'

const recoverable = (error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') return false
    if (typeof error === 'object' && error && 'isRetryable' in error && typeof error.isRetryable === 'boolean') {
        return error.isRetryable
    }
    const status = typeof error === 'object' && error && 'statusCode' in error
        ? Number(error.statusCode)
        : typeof error === 'object' && error && 'status' in error
            ? Number(error.status)
            : 0
    if (status) return status === 408 || status === 409 || status === 429 || status >= 500
    return error instanceof TypeError
}

const run = async <T>(operation: () => Promise<T>, signal?: AbortSignal, shouldRetry = recoverable): Promise<T> => {
    let delay = Store.config.retry.baseDelay
    while (true) {
        signal?.throwIfAborted()
        try {
            return await operation()
        } catch (error) {
            signal?.throwIfAborted()
            if (!shouldRetry(error)) throw error
            await new Promise<void>((resolve, reject) => {
                if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
                const timer = setTimeout(resolve, delay)
                signal?.addEventListener('abort', () => {
                    clearTimeout(timer)
                    reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
                }, { once: true })
            })
            delay = Math.min(delay * Store.config.retry.factor, Store.config.retry.maxDelay)
        }
    }
}

export default { recoverable, run }
