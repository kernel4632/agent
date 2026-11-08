/*
文件系统浏览：给设置页的路径选择器列出一层目录/文件。只读、不返回文件内容。
调用示例：
  await Filesystem.entries({ path: 'D:\\', mode: 'directory' })
  // { current, parent, home, roots, entries: [{ name, path, type }], truncated }
*/
import { readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import Path from '../utils/path.js'
import fail from '../utils/fail.js'
import Fs from '../utils/fs.js'

const LIMIT = 500
let cachedRoots = null

const exists = Fs.exists

const windowsRoots = async () => {
    const roots = []
    for (let code = 65; code <= 90; code += 1) {
        const root = `${String.fromCharCode(code)}:\\`
        if (await exists(root)) roots.push(root)
    }
    return roots.length ? roots : ['C:\\']
}

const roots = async () => {
    if (cachedRoots) return cachedRoots
    cachedRoots = process.platform === 'win32' ? await windowsRoots() : ['/']
    return cachedRoots
}

const expand = input => {
    const value = String(input || '').trim()
    if (!value) return ''
    if (value === '~') return Path.userHome()
    if (value.startsWith('~/') || value.startsWith('~\\')) return join(Path.userHome(), value.slice(2))
    return value
}

const typeOf = async (parent, entry) => {
    if (entry.isDirectory()) return 'directory'
    if (entry.isFile()) return 'file'
    if (!entry.isSymbolicLink()) return ''
    try { return (await stat(join(parent, entry.name))).isDirectory() ? 'directory' : 'file' } catch { return '' }
}

const entries = async ({ path = '', mode = 'directory' } = {}) => {
    if (!['directory', 'file'].includes(mode)) throw fail(400, 'mode 必须是 directory 或 file')
    const requested = expand(path)
    let current = requested || Path.userHome()
    if (!isAbsolute(current)) throw fail(400, '路径必须是绝对路径')
    if (!await exists(current)) throw fail(404, `目录不存在：${current}`)
    if (!(await stat(current)).isDirectory()) current = dirname(current)

    const nodes = await readdir(current, { withFileTypes: true })
    const all = []
    for (const entry of nodes) {
        const type = await typeOf(current, entry)
        if (!type) continue
        if (mode === 'directory' && type !== 'directory') continue
        all.push({ name: entry.name, path: join(current, entry.name), type })
    }
    all.sort((first, second) => {
        if (first.type !== second.type) return first.type === 'directory' ? -1 : 1
        return first.name.localeCompare(second.name, 'zh-CN')
    })
    const parent = dirname(current)
    return {
        current,
        parent: parent === current ? null : parent,
        home: Path.userHome(),
        roots: await roots(),
        entries: all.slice(0, LIMIT),
        truncated: all.length > LIMIT,
    }
}

const clear = () => { cachedRoots = null }

export default { entries, clear }
