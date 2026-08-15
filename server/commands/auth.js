/* 浏览器登录状态只保存在内存中，重启后所有 token 都会失效。 */
import { nanoid } from 'nanoid'
import Store from '../store.js'

const tokens = new Set()

const login = (username, password) => {
    // 未设置账号时保持本地开发模式，任何请求都可以通过鉴权。
    if (!Store.config.auth.username) return nanoid()

    // 设置账号后必须同时匹配用户名和密码。
    if (username !== Store.config.auth.username || password !== Store.config.auth.password) return null

    const token = nanoid()
    tokens.add(token)
    return token
}

const logout = token => {
    tokens.delete(token)
}

const verify = token => {
    if (!Store.config.auth.username) return true
    return tokens.has(token)
}

export default { login, logout, verify }
