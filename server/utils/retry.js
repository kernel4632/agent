/**
 * 使用示例
 *
 * const result = await Retry.run(
 *   () => fetch('https://api.example.com/data'),
 *   {
 *     signal: abortController.signal,
 *     onRetry({ attempt, delay, error }) {
 *       console.log(`第${attempt}次重试，等待${delay}ms，原因：${error.message}`)
 *     }
 *   }
 * )
 */

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "UND_ERR_SOCKET"]);

function isRetryable(error) {
	if (RETRYABLE_STATUS.has(error.status)) return true;
	if (RETRYABLE_CODES.has(error.code)) return true;
	if (error.message?.includes("fetch failed")) return true;
	return false;
}

export const Retry = {
	/**
	 * @param {function} fn - 要执行的异步函数 () => Promise<T>
	 * @param {object} options
	 * @param {AbortSignal} options.signal - 中止信号，abort 时立即停止重试
	 * @param {function} options.onRetry - ({ attempt, delay, error }) => void
	 * @param {number} options.baseDelay - 基础等待毫秒，默认 1000
	 * @param {number} options.maxDelay - 最大等待毫秒，默认 60000
	 *
	 * @returns {Promise<T>}
	 * @throws 不可重试的错误 / abort 直接抛出
	 */
	async run(fn, { signal, onRetry, baseDelay = 1000, maxDelay = 60000 } = {}) {
		let attempt = 0;

		while (true) {
			try {
				return await fn();
			} catch (error) {
				if (signal?.aborted) throw error;
				if (error.name === "AbortError") throw error;
				if (!isRetryable(error)) throw error;

				attempt++;
				const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);

				onRetry?.({ attempt, delay, error });

				await Retry.wait(delay, signal);
			}
		}
	},

	wait(ms, signal) {
		return new Promise((resolve, reject) => {
			if (signal?.aborted) return reject(signal.reason);
			const timer = setTimeout(resolve, ms);
			signal?.addEventListener(
				"abort",
				() => {
					clearTimeout(timer);
					reject(signal.reason);
				},
				{ once: true },
			);
		});
	},
};
