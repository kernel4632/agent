/*
 * 带状态码的业务错误：commands/features/tools 共用，入口按 status 返回。
 * 调用示例：throw fail(404, `Session not found: ${sessionId}`)
 */

const fail = (status, message) => Object.assign(new Error(message), { status })

export default fail
