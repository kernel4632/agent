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

const LIMIT = 500                                 // 一次最多列 500 项，避免在巨大目录上卡住
let cachedRoots = null                             // 盘符列表只查一次，磁盘不会变

const exists = Fs.exists

// Windows 的盘符表用 A-Z 挨个试 exists，能查到才收进来。
const windowsRoots = async () => {
    const roots = []
    for (let code = 65; code <= 90; code += 1) {            // 'A' 到 'Z'
        const root = `${String.fromCharCode(code)}:\\`
        if (await exists(root)) roots.push(root)
    }
    return roots.length ? roots : ['C:\\']              // 一个都没有就回退 C 盘
}

// 根目录列表缓存：Linux/macOS 永远只有 /，Windows 取决于装了几个盘。
const roots = async () => {
    if (cachedRoots) return cachedRoots
    cachedRoots = process.platform === 'win32' ? await windowsRoots() : ['/']
    return cachedRoots
}

// 把 ~ 展开成用户主目录；空字符串和无效输入都回空。
const expand = input => {
    const value = String(input || '').trim()
    if (!value) return ''
    if (value === '~') return Path.userHome()
    if (value.startsWith('~/') || value.startsWith('~\\')) return join(Path.userHome(), value.slice(2))
    return value                                  // 不是 ~ 开头就原样返回，由调用方判断是否合法
}

// 取一个条目的类型；symlink 要跟过去看它指向的是文件还是目录。
const typeOf = async (parent, entry) => {
    if (entry.isDirectory()) return 'directory'
    if (entry.isFile()) return 'file'
    if (!entry.isSymbolicLink()) return ''         // 不认识就不收，避免列出设备名等无意义项
    try { return (await stat(join(parent, entry.name))).isDirectory() ? 'directory' : 'file' } catch { return '' }  // symlink 断了也回空
}

// 列一层目录：mode=directory 只列子目录，mode=file 列文件和目录。
// 传进来的路径是用户写的（可能含 ~、可能指向一个文件），这里负责归一化：
// 文件就退到它所在的目录，不存在就报错。
const entries = async ({ path = '', mode = 'directory' } = {}) => {
    if (!['directory', 'file'].includes(mode)) throw fail(400, 'mode 必须是 directory 或 file')
    const requested = expand(path)
    let current = requested || Path.userHome()   // 空路径默认从用户主目录开始
    if (!isAbsolute(current)) throw fail(400, '路径必须是绝对路径')
    if (!await exists(current)) throw fail(404, `目录不存在：${current}`)
    if (!(await stat(current)).isDirectory()) current = dirname(current)  // 传进来的是文件就列它所在目录

    const nodes = await readdir(current, { withFileTypes: true })
    const all = []
    for (const entry of nodes) {
        const type = await typeOf(current, entry)
        if (!type) continue                       // 跳过无法识别的条目
        if (mode === 'directory' && type !== 'directory') continue
        all.push({ name: entry.name, path: join(current, entry.name), type })
    }
    // 目录排前面，再按名字排序，跟文件管理器的习惯一致
    all.sort((first, second) => {
        if (first.type !== second.type) return first.type === 'directory' ? -1 : 1
        return first.name.localeCompare(second.name, 'zh-CN')
    })
    const parent = dirname(current)
    return {
        current,
        parent: parent === current ? null : parent,  // 根目录的 parent 是自己，回 null 避免无限向上
        home: Path.userHome(),
        roots: await roots(),
        entries: all.slice(0, LIMIT),
        truncated: all.length > LIMIT,              // 超过上限告诉前端，让它显示"还有更多"
    }
}

// 清掉盘符缓存：测试用，保证下次读的是真实磁盘状态
const clear = () => { cachedRoots = null }

export default { entries, clear }
