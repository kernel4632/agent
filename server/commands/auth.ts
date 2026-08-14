/*
鉴权指令：验证用户配置中的明文账密并管理内存登录令牌。
令牌随进程重启失效，不额外建立数据库或会话文件。
*/
import { randomBytes, timingSafeEqual } from 'node:crypto'
import Store from '../store.ts'

const tokens = new Set<string>()

const login = (username: string, password: string) => {
    const configured = Store.config.auth
    const usernameBytes = Buffer.from(username)
    const configuredUsername = Buffer.from(configured.username)
    const passwordBytes = Buffer.from(password)
    const configuredPassword = Buffer.from(configured.password)
    if (usernameBytes.length !== configuredUsername.length || !timingSafeEqual(usernameBytes, configuredUsername)) return null
    if (passwordBytes.length !== configuredPassword.length || !timingSafeEqual(passwordBytes, configuredPassword)) return null
    const token = randomBytes(32).toString('base64url')
    tokens.add(token)
    return token
}

const logout = (token: string) => tokens.delete(token)
const verify = (token?: string) => !Store.config.auth.username || Boolean(token && tokens.has(token))

const reset = () => tokens.clear()

export default { login, logout, verify, reset }
