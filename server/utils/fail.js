/*
 * 带状态码的业务错误。
 *
 * 指令用 fail() 把"用户填错了"和"程序出问题了"分开，入口按状态码返回。
 * 调用示例：
 *   throw fail(404, `Session not found: ${sessionId}`)
 *   throw fail(400, 'title must be a non-empty string')
 */

const fail = (status, message) => Object.assign(new Error(message), { status })

export default fail
