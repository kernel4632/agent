/*
异步重试工具：对可恢复操作执行带随机抖动的指数退避，直到成功或外部中断。
本文件不认识模型或会话，只负责时间计算与重复调用，因此可独立复用。
调用示例：await retry(() => fetch(url), onRetry, abortSignal)。
*/

// --- 持续重试异步操作 ---
export async function retry(operation, onRetry, abortSignal) {
  let attempt = 0                                           // 首次失败从第 1 次重试开始计数
  while (!abortSignal?.aborted) {                           // 用户未中断时持续尝试，不设次数上限
    try {
      return await operation()                              // 成功结果立即反馈给调用方
    } catch (error) {
      if (abortSignal?.aborted || error?.name === 'AbortError') { // 用户中断不是连接故障，禁止反馈重试
        throw new DOMException('operation aborted', 'AbortError') // 立即将停止状态交回 Agent 循环
      }
      if (!isRetryableError(error)) throw error                    // 认证、参数和资源错误必须立即反馈用户修正
      attempt += 1                                          // 记录即将执行的重试序号
      const exponentialDelay = Math.min(1000 * 2 ** (attempt - 1), 60000) // 延迟最多增长到 60 秒
      const nextRetryIn = exponentialDelay + Math.floor(Math.random() * 1000) // 随机抖动避免并发拥堵
      await onRetry?.({ error, attempt, nextRetryIn })       // 延迟前反馈失败原因和等待时间
      await waitForRetry(nextRetryIn, abortSignal)          // 等待期间也允许用户立即停止
    }
  }

  throw new DOMException('operation aborted', 'AbortError') // 外部中断时结束无限重试
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
      reject(new DOMException('operation aborted', 'AbortError')) // 反馈标准中断结果
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
