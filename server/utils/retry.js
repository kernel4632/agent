/*
无限重试工具：对网络、限流和服务端错误执行可中断的指数退避。
本工具不设置重试次数或总时间上限，只由成功、不可重试错误或 AbortSignal 结束。
调用示例：await retry((signal) => fetch(url, { signal }), onRetry, abortSignal)。
*/

// --- 无限重试可恢复操作 ---
export async function retry(operation, onRetry, abortSignal, options = {}) {
  const baseDelay = options.baseDelay ?? 1000           // 第一次重试默认等待一秒
  const maxDelay = options.maxDelay ?? 60000            // 只限制单次等待，绝不限制重试次数
  const jitter = options.jitter ?? 500                  // 随机错开多个会话的重试时刻
  let attempt = 0                                       // 记录已经进入的重试轮次

  while (true) {
    abortSignal?.throwIfAborted()                       // 用户停止时不再开始新请求
    try {
      return await operation(abortSignal)               // 成功结果立即结束无限循环
    } catch (error) {
      abortSignal?.throwIfAborted()                     // 停止优先于网络错误反馈
      if (!isRetryable(error)) throw error              // 配置和客户端错误立即交给 Agent
      attempt += 1                                      // 记录即将等待的重试轮次
      const exponential = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay) // 等待最多增长到配置上限
      const nextRetryIn = exponential + Math.floor(Math.random() * jitter) // 添加轻量随机抖动
      await onRetry?.({ error: normalizeError(error), attempt, nextRetryIn }) // 向调用方反馈本次重试
      await wait(nextRetryIn, abortSignal)              // 等待期间仍可被用户立即停止
    }
  }
}


// --- 判断错误是否可恢复 ---
function isRetryable(error) {
  if (error?.name === 'AbortError') return false        // 主动中断不能重新发起请求
  const message = String(error?.message ?? error)       // 兼容 AI SDK 包装错误
  const status = Number(error?.statusCode ?? error?.status ?? error?.response?.status ?? message.match(/(?:status|status_code)[=: ]+(\d{3})/i)?.[1]) // 提取常见 HTTP 状态
  if (!Number.isFinite(status)) return true             // 断网和连接重置通常没有状态码
  return status === 408 || status === 429 || status >= 500 // 超时、限流和服务端错误持续重试
}


// --- 等待下一次重试 ---
function wait(delay, abortSignal) {
  if (!abortSignal) return Bun.sleep(delay)             // 无停止信号时使用普通等待
  return new Promise((resolve, reject) => {
    if (abortSignal.aborted) return reject(abortSignal.reason) // 已停止时不创建定时器
    const timer = setTimeout(finish, delay)             // 延迟结束后进入下一次请求
    function finish() {
      abortSignal.removeEventListener('abort', abort)   // 正常完成后释放监听
      resolve()
    }
    function abort() {
      clearTimeout(timer)                               // 用户停止时取消旧定时器
      reject(abortSignal.reason ?? new DOMException('operation aborted', 'AbortError')) // 保留停止原因
    }
    abortSignal.addEventListener('abort', abort, { once: true }) // 当前等待只处理一次停止
  })
}


// --- 统一错误对象 ---
function normalizeError(error) {
  return error instanceof Error ? error : new Error(String(error)) // 回调始终收到 Error
}
