class HTTPError extends Error {
    constructor(public status: 404 | 409 | 422, public code: string, message: string) {
        super(message)
    }
}

const notFound = (message: string) => new HTTPError(404, 'NOT_FOUND', message)
const conflict = (message: string) => new HTTPError(409, 'CONFLICT', message)
const invalid = (message: string) => new HTTPError(422, 'INVALID_INPUT', message)
const networkCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETDOWN', 'ENETUNREACH', 'EHOSTUNREACH'])
const retryable = (error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') return false
    const declared = typeof error === 'object' && error && 'isRetryable' in error && typeof error.isRetryable === 'boolean' ? error.isRetryable : undefined
    if (declared === false) return false
    const status = Number(typeof error === 'object' && error && ('statusCode' in error ? error.statusCode : 'status' in error ? error.status : 0))
    if (status) return status === 408 || status === 429 || status >= 500
    if (declared === true) return true
    if (!(error instanceof TypeError)) return false
    const code = String((error.cause as { code?: unknown } | undefined)?.code ?? '')
    return code ? networkCodes.has(code) : /fetch failed|network|socket|connection|terminated/i.test(error.message)
}

export { HTTPError }
export default { notFound, conflict, invalid, retryable }
