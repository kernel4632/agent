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
      attempt += 1                                          // 记录即将执行的重试序号
      const exponentialDelay = Math.min(1000 * 2 ** (attempt - 1), 60000) // 延迟最多增长到 60 秒
      const nextRetryIn = exponentialDelay + Math.floor(Math.random() * 1000) // 随机抖动避免并发拥堵
      await onRetry?.({ error, attempt, nextRetryIn })       // 延迟前反馈失败原因和等待时间
      await Bun.sleep(nextRetryIn)                          // 等待后重新执行同一个操作
    }
  }

  throw new DOMException('operation aborted', 'AbortError') // 外部中断时结束无限重试
}
