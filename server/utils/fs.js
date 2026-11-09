/*
 * 文件系统小工具：路径存在性、目录判断、原子读写、子目录判断。
 *
 * 这些判断在 skills / storage / filesystem / temp-workspace 里各写过一份，
 * 四份实现虽然只差几行，但漂移起来很难发现（比如一处用 access、一处用 stat，
 * 对 symlink 的行为就不一样）。统一收到这里，只维护一套。
 *
 * 调用示例：
 *   await Fs.exists(path)
 *   await Fs.isDirectory(path)
 *   const data = await Fs.readJson(file, {})
 *   await Fs.writeJson(file, value)
 *   Fs.inside(root, target)
 */

import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

// --- 路径是否存在；不存在或没权限都算不存在 ---
const exists = async path => {
    try {
        await access(path)
        return true
    } catch {
        return false
    }
}

// --- 是不是一个目录 ---
// 用 stat 而不是 lstat：~/.claude/skills 这类目录常常是指向真实技能库的
// symlink / junction，lstat 会把它们当成非目录直接跳过。
const isDirectory = async path => {
    try {
        return (await stat(path)).isDirectory()
    } catch {
        return false
    }
}

// --- 是不是一个普通文件 ---
const isFile = async path => {
    try {
        return (await stat(path)).isFile()
    } catch {
        return false
    }
}

// --- 读 JSON；文件不在或内容坏了都用 fallback ---
const readJson = async (path, fallback = null) => {
    try {
        return JSON.parse(await readFile(path, 'utf8'))
    } catch {
        return fallback
    }
}

// --- 原子写 JSON：先写临时文件再 rename，中途崩溃不会留下半份 ---
// 模式 0600：这些文件里可能有密钥（MCP 的 env、供应商的 apiKey）。
const writeJson = async (path, value, { mode = 0o600 } = {}) => {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.tmp-${crypto.randomUUID()}`
    await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode })
    await rename(temporary, path)
}

// --- child 是否在 parent 里面（含相等） ---
// 用 relative 而不是 startsWith 拼字符串：后者会把 /a/bc 当成 /a/b 的子目录。
const inside = (parent, child) => {
    const path = relative(resolve(String(parent)), resolve(String(child)))
    if (!path) return true                                   // 同一个位置
    return !path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path)
}

// --- child 是否在 parent 里面，但不含相等 ---
const within = (parent, child) => {
    const base = resolve(String(parent))
    const target = resolve(String(child))
    return target !== base && inside(base, target)
}

export { exists, isDirectory, isFile, readJson, writeJson, inside, within }
export default { exists, isDirectory, isFile, readJson, writeJson, inside, within }
