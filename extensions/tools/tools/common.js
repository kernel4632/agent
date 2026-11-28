/*
文件类工具共用：路径、敏感文件、输出截断、写入前快照。
工具在子进程里只拿 args 跑，这里只用 Node 内置模块。
*/

import { copyFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

const SKIP = new Set(['node_modules', '.git', 'vendor', '.venv', 'venv', '__pycache__', 'dist', 'build', 'coverage', '.next', '.nuxt', '.output'])

/*
工具的默认工作目录：系统临时目录下的 agent 沙箱（AGENT_SANDBOX，默认 %TEMP%/agent-sandbox）。
框架给模型一个确定存在、可以随便写的沙箱：不猜用户盘符，也不落在 AGENT_HOME 里——
敏感名单会拦 .agent 数据目录下的写操作，沙箱混在里面会自己打自己；系统临时目录天然隔离。
绝对路径不受影响（模型仍可写用户指定的位置），相对路径全部落在沙箱里。
*/
export function sandboxRoot() {
    return process.env.AGENT_SANDBOX || join(tmpdir(), 'agent-sandbox')
}

/** @param {string} [cwd] */
export function root(cwd) {
    return cwd && isAbsolute(cwd) ? cwd : resolve(sandboxRoot(), cwd || '.')
}

/** @param {string | undefined} path @param {string} [cwd] @returns {string} */
export function resolvePath(path, cwd) {
    if (!path || typeof path !== 'string') throw new Error('path 不能为空')
    return isAbsolute(path) ? path : resolve(root(cwd), path)
}

/** @param {string | undefined} path */
export function sensitive(path) {
    const text = String(path).replace(/\\/g, '/')
    const name = basename(text)
    if (/^\.env($|\.)/.test(name) || /\.(pem|key|p12|pfx)$/i.test(name)) return true
    if (/^id_(rsa|ed25519)/.test(name) || name === '.npmrc' || name === '.netrc' || name === '.git-credentials') return true
    return /\/(\.ssh|\.aws|\.gnupg|\.agent)\//.test(text + '/')
}

/** @param {string | undefined} path @returns {string} */
export function guard(path) {
    if (sensitive(path)) throw new Error(`拒绝访问敏感文件：${path}`)
    return /** @type {string} */ (path)
}

/** @param {string} path */
export function skip(path) {
    return String(path).replace(/\\/g, '/').split('/').some(part => SKIP.has(part))
}

/** @param {string} text @param {number} [limit] */
export function truncate(text, limit = 20000) {
    if (typeof text !== 'string' || text.length <= limit) return text
    const head = Math.floor(limit * 0.7)
    const tail = limit - head
    return `${text.slice(0, head)}\n\n…（中间省略 ${text.length - limit} 个字符）…\n\n${text.slice(-tail)}`
}

/** @param {string} path */
export async function snapshot(path) {
    try { await stat(path) } catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null; throw error }
    const dir = join(dirname(path), '.agent', 'snapshots')
    await mkdir(dir, { recursive: true })
    const dest = join(dir, `${Date.now()}-${basename(path)}`)
    await copyFile(path, dest)
    return dest
}
