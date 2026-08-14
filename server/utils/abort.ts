const race = <T>(promise: Promise<T>, signal: AbortSignal) => new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
})

export default { race }
