/*
 * 忽略规则：工具要碰的文件里，哪些不许碰。
 *
 * 规则写在数据目录的 .agentignore 里，一行一条，写法同 .gitignore；
 * 内置的敏感文件规则永远生效，用户改不掉，避免误配把密钥暴露出去。
 * 调用示例：
 *   await Ignore.load()                                        // 启动时读一次
 *   Ignore.blocks({ toolName: 'file_read', input: { path: 'secret.env' } })  // true / false
 *   Ignore.reason                                              // 被拦住时给用户看的原因
 */

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import picomatch from 'picomatch'
import Path from '../utils/path.js'

/*
 * 内置规则：这些文件里有密钥、凭据和机器私钥，模型读到就会进入对话历史和日志，
 * 用户看不见也删不掉。所以不管用户怎么配，它们默认都是拦的。
 */
const BUILT_IN = [
    '.env',
    '.env.*',
    '*.pem',
    '*.key',
    '*.p12',
    '*.pfx',
    'id_rsa*',
    'id_ed25519*',
    '.npmrc',
    '.netrc',
    '.git-credentials',
    '**/.ssh/**',
    '**/.aws/**',
    '**/.gnupg/**',
    // agent 自己的数据目录里有 API Key 和全部会话，不允许工具再去读它。
    '**/.agent/**',
]

// 只拦"会读或写文件"的工具；命令工具无法只看参数判断，交给权限规则处理。
const FILE_TOOLS = ['file_read', 'file_write', 'file_list', 'edit', 'apply_patch', 'glob', 'grep']

let patterns = BUILT_IN // 用户规则加载成功后追加到内置规则后面。
let matchers = []

// --- 编译规则 ---
const compile = list => list.flatMap(line => {
    const rule = line.trim()
    // 空行和 # 开头的注释不参与匹配。
    if (!rule || rule.startsWith('#')) return []
    return [picomatch(rule, { dot: true, basename: true })]
})

// --- 加载用户规则 ---
const load = async () => {
    const file = Bun.file(Path.ignore())
    // 用户没写规则文件也照常工作，内置规则本来就够用。
    const extra = await file.exists() ? (await readFile(Path.ignore(), 'utf8')).split('\n') : []
    patterns = [...BUILT_IN, ...extra]
    matchers = compile(patterns)
    return patterns
}

// --- 取出这次调用要碰的路径 ---
const pathsOf = input => {
    // 文件工具的参数里有 path，补丁工具的参数里是 patches 数组，两种都要看。
    const found = []
    if (typeof input?.path === 'string') found.push(input.path)
    for (const patch of input?.patches || []) if (typeof patch?.path === 'string') found.push(patch.path)
    return found
}

// --- 这次调用是不是被规则拦住 ---
const blocks = ({ toolName, input }) => {
    if (!FILE_TOOLS.includes(toolName)) return false // 命令工具的参数是一整条命令，交给权限规则判断。
    // 只要能命中路径里的文件名就拦：模型写的是绝对路径还是相对路径都不影响。
    return pathsOf(input).some(path => matchers.some(match => match(path) || match(basename(path))))
}

export default { load, blocks }
