/*
异步重试工具：对可恢复操作执行带随机抖动的指数退避，直到成功、达到预算或外部中断。
本文件不认识模型或会话，只负责时间计算与重复调用，因此可独立复用。
调用示例：await retry((signal) => fetch(url, { signal }), onRetry, abortSignal)。
*/

// --- 在次数和时间预算内重试异步操作 ---
export async function retry(operation, onRetry, abortSignal, options = {}) {
  const maxRetries = options.maxRetries ?? 3                 // 默认最多在首次失败后重试三次
  const maxElapsedMs = options.maxElapsedMs ?? 120000        // 单个模型轮次默认最多占用两分钟
  const baseDelayMs = options.baseDelayMs ?? 1000            // 测试可缩短退避但生产保持一秒起步
  const jitterMs = options.jitterMs ?? 1000                  // 随机抖动避免并发 Run 同时冲击上游
  const deadline = new AbortController()                     // 总预算可以中断正在进行的真实请求
  const deadlineTimer = setTimeout(() => deadline.abort(new DOMException(`retry budget exceeded after ${maxElapsedMs}ms`, 'TimeoutError')), maxElapsedMs) // 到期后关闭本轮全部尝试
  const operationSignal = abortSignal ? AbortSignal.any([abortSignal, deadline.signal]) : deadline.signal // 合并用户停止和内部预算
  let attempt = 0                                           // 首次失败从第 1 次重试开始计数
  try {
    while (!operationSignal.aborted) {                      // 用户停止或总预算到期都会退出循环
      try {
        return await operation(operationSignal)             // 将组合信号传给真实网络请求
      } catch (error) {
        if (abortSignal?.aborted) {                         // 用户中断不是连接故障，禁止反馈重试
          throw new DOMException('operation aborted', 'AbortError') // 立即将停止状态交回 Agent 循环
        }
        if (deadline.signal.aborted) throw deadline.signal.reason // 总预算到期反馈明确超时原因
        if (error?.name === 'AbortError') throw error       // 上游主动中断不应被重复请求掩盖
        if (!isRetryableError(error)) throw error           // 认证、参数和资源错误必须立即反馈用户修正
        if (attempt >= maxRetries) throw error              // 达到次数预算后保留最后一次真实上游错误
        attempt += 1                                        // 记录即将执行的重试序号
        const exponentialDelay = Math.min(baseDelayMs * 2 ** (attempt - 1), 60000) // 延迟最多增长到 60 秒
        const nextRetryIn = exponentialDelay + Math.floor(Math.random() * jitterMs) // 可控抖动避免并发拥堵
        await onRetry?.({ error, attempt, nextRetryIn })     // 延迟前反馈失败原因和等待时间
        await waitForRetry(nextRetryIn, operationSignal)    // 等待期间也接受用户停止和预算到期
      }
    }
    if (abortSignal?.aborted) throw new DOMException('operation aborted', 'AbortError') // 外部中断保持取消语义
    throw deadline.signal.reason                            // 预算到期反馈 TimeoutError
  } finally {
    clearTimeout(deadlineTimer)                             // 成功、失败和中断都释放预算定时器
  }
}


// --- 等待下一次重试或外部中断 ---
function waitForRetry(delay, abortSignal) {
  if (!abortSignal) return Bun.sleep(delay)                  // 无中断信号时使用普通退避等待
  return new Promise((resolve, reject) => {                  // 将定时器和中断合并为同一个等待点
    const finishWait = () => {                               // 正常完成时同时释放中断监听
      abortSignal.removeEventListener('abort', abortWait)    // 已完成等待不保留会话信号引用
      resolve()                                              // 允许循环进入下一次尝试
    }
    const timer = setTimeout(finishWait, delay)              // 延迟结束后允许下一次尝试
    const abortWait = () => {                                // 用户停止时立即取消退避
      clearTimeout(timer)                                    // 防止旧定时器稍后唤醒循环
      reject(abortSignal.reason || new DOMException('operation aborted', 'AbortError')) // 保留用户取消或预算超时的真实原因
    }
    abortSignal.addEventListener('abort', abortWait, { once: true }) // 当前退避只监听一次中断
  })
}


// --- 判断错误是否值得重试 ---
function isRetryableError(error) {
  const status = Number(error?.statusCode ?? error?.status ?? error?.response?.status ?? String(error?.message ?? error).match(/status(?:_code)?[=: ]+(\d{3})/i)?.[1]) // 兼容 AI SDK 和中转错误结构
  if (!Number.isFinite(status)) return true                   // 无 HTTP 状态的断网和连接重置通常可恢复
  return status === 408 || status === 429 || status >= 500   // 超时、限流和服务端错误进入退避
}
