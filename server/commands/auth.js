/* 浏览器登录状态只保存在内存中，重启后所有 token 都会失效。 */
import { nanoid } from 'nanoid' // 生成不可预测的浏览器 token。
import Store from '../store.js' // 读取当前启用的登录配置。

const tokens = new Set() // 只保存本次进程仍有效的登录票据。

const login = (username, password) => {
    // 未设置账号时保持本地开发模式，任何请求都可以通过鉴权。
    if (!Store.config.auth.username) return nanoid() // 未配置账号时给本地访问发临时票据。

    // 设置账号后必须同时匹配用户名和密码。
    if (username !== Store.config.auth.username || password !== Store.config.auth.password) return null // 不匹配时不建立登录态。

    const token = nanoid() // 为这次登录单独生成票据。
    tokens.add(token) // 记录票据，供后续私有路由校验。
    return token // 交给 HTTP 层写入 HttpOnly cookie。
}

const logout = token => {
    tokens.delete(token) // 立即让浏览器持有的旧票据失效。
}

const verify = token => {
    if (!Store.config.auth.username) return true // 本地开发模式不要求 cookie。
    return tokens.has(token) // 只有本进程签发且未注销的票据可通过。
}

export default { login, logout, verify } // 暴露登录、注销和路由鉴权动作。
