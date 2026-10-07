/*
 * 忽略规则：工具要碰的文件里，哪些不许碰。
 *
 * 规则写在数据目录的 .agentignore 里，一行一条，写法同 .gitignore；
 * 内置的敏感文件规则在模块加载时就编译好了，永远生效，用户改不掉，避免误配把密钥暴露出去。
 * 调用示例：
 *   await Ignore.load()                                                      // 启动时读一次用户规则
 *   Ignore.blocks({ toolName: 'file_read', input: { path: 'secret.env' } })  // true / false
 *   Ignore.blockedBy({ toolName: 'file_read', input: { path: 'secret.env' } })  // '.env'，给用户看是哪条规则
 */

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import picomatch from 'picomatch'
import Path from '../utils/path.js'
import { toolFiles } from '../utils/tool-files.js' // 一次调用会碰哪些文件。

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

// --- 编译规则 ---
const compile = list => list.flatMap(line => {
    const rule = line.trim()
    // 空行和 # 开头的注释不参与匹配。
    if (!rule || rule.startsWith('#')) return []
    return [{ rule, matches: picomatch(rule, { dot: true, basename: true }) }]
})

/*
 * 生效中的规则，模块加载时就先按内置规则编好。
 * 这一点不能省：如果初值是空数组，任何一个忘了先 load() 的调用方都会静默地放行全部文件，
 * 连内置的 .env 保护也一起失效，而且不报任何错。默认必须是"拦住"，不是"放行"。
 */
let rules = compile(BUILT_IN)

/**
 * 读用户自己写的忽略规则，追加到内置规则后面。
 * 用户没写这个文件也照常工作，内置规则本来就够用。
 * @returns {Promise<string[]>} 生效中的全部规则原文，调试时用得上。
 */
const load = async () => {
    const file = Bun.file(Path.ignore())
    const extra = await file.exists() ? (await readFile(Path.ignore(), 'utf8')).split('\n') : []
    rules = compile([...BUILT_IN, ...extra])
    return rules.map(entry => entry.rule)
}

/**
 * 这次调用碰的文件里，第一条命中的规则。
 * @param {{ toolName: string, input: object }} call 模型这次想调用的工具和参数。
 * @returns {string|null} 命中的规则原文；没被拦住时是 null。
 */
const blockedBy = ({ toolName, input }) => {
    // 会碰哪些文件由 utils/tool-files.js 一处说了算，这里只负责判断它们该不该拦。
    // 命中路径里的文件名也算：模型写的是绝对路径还是相对路径都不影响。
    for (const path of toolFiles({ toolName, input })) {
        const hit = rules.find(entry => entry.matches(path) || entry.matches(basename(path)))
        if (hit) return hit.rule
    }
    return null
}

/**
 * 这次调用要不要拦。
 * @param {{ toolName: string, input: object }} call 模型这次想调用的工具和参数。
 * @returns {boolean} true 表示不许碰，工具不该执行。
 */
const blocks = call => blockedBy(call) !== null

export default { load, blocks, blockedBy }
