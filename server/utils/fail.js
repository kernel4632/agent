/*
 * 带状态码的业务错误。
 *
 * 指令用 fail() 把"用户填错了"和"程序出问题了"分开，入口按状态码发回给调用方。
 * 调用示例：
 *   throw fail(404, `Session not found: ${sessionId}`)
 *   throw fail(400, 'title must be a non-empty string')
 *   // 入口：set.status = error.status || 500
 */

// --- 做一个带状态码的错误 ---
const fail = (status, message) => Object.assign(new Error(message), { status })

export default fail
