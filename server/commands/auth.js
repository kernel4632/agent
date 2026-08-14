/* 浏览器登录状态，只保存在内存中。 */
import { nanoid } from 'nanoid'
import Store from '../store.js'

const tokens = new Set()

const login = (username, password) => {
    if (!Store.config.auth.username) return nanoid()
    if (username !== Store.config.auth.username || password !== Store.config.auth.password) return null
    const token = nanoid()
    tokens.add(token)
    return token
}

const logout = token => tokens.delete(token)
const verify = token => !Store.config.auth.username || tokens.has(token)

export default { login, logout, verify }
