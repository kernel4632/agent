/*
重试工具：无限重试 + 指数退避，可被 AbortSignal 中断。
根据 HTTP 状态码和网络错误码判断是否可重试，不可重试的错误直接抛出。
调用示例：const result = await Retry.run(() => fetch(url), { signal, onRetry: ({ attempt, delay, error }) => {} })。
*/

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]) // 可重试的 HTTP 状态码
const RETRYABLE_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'UND_ERR_SOCKET']) // 可重试的网络错误码


// --- 执行带重试的异步任务 ---
async function run(fn, { signal, onRetry, baseDelay = 1000, maxDelay = 60000 } = {}) {
  let attempt = 0

  while (true) {
    try {
      return await fn()
    } catch (error) {
      if (signal?.aborted) throw error                   // 已中止时直接抛出，不再重试
      if (error.name === 'AbortError') throw error       // abort 错误不重试
      if (!RETRYABLE_STATUS.has(error.status) && !RETRYABLE_CODES.has(error.code) && !error.message?.includes('fetch failed')) throw error // 不可重试的错误直接抛出

      attempt++
      const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay) // 指数退避，上限 60 秒
      onRetry?.({ attempt, delay, error })               // 通知调用方当前重试状态
      await wait(delay, signal)                          // 等待后进入下一轮
    }
  }
}


// --- 可中断的等待 ---
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)    // 已中止时立即拒绝
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
  })
}


export const Retry = { run, wait }
