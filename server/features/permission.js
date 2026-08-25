/* 
目标被调用形式（绝对不可修改）：
// 1. 加载规则
await Permission.load({
    path: "/path/to/permission.json",
})

// 2. 检查权限，先走规则表，如果是ask就向前端发请求，得到是批准还是拒绝
const result = await Permission.check({
    toolName: "edit",              // 工具名
    arguments: {                   // 工具参数，用于匹配
        path: "src/index.js",
    },
    onAsk: async request => true,   // 规则为 ask 时询问前端，返回同意或拒绝
})
// result = true | false

// 3. 保存规则
 await Permission.save({
     path: "/path/to/permission.json",
 })
 */

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically'
import picomatch from 'picomatch'

// 没有规则文件时，所有工具都先询问用户，不会自动执行。
let rules = { '*': 'ask' }

const flatten = value => {
    // 所有工具都走同一条路：对象和数组继续展开，普通值变成可匹配文字。
    if (Array.isArray(value)) return value.flatMap(flatten)
    if (value && typeof value === 'object') return Object.values(value).flatMap(flatten)
    return [String(value)]
}

const matchValue = input => flatten(input).join(' ')

const resolveAction = ({ toolName, input }) => {
    const globalRule = rules['*']
    const toolRule = rules[toolName]

    // 工具没有自己的规则时，直接使用全局规则；默认永远是 ask。
    if (toolRule === undefined) return globalRule === 'allow' ? 'allow' : 'ask'
    if (typeof toolRule === 'string') return toolRule === 'allow' ? 'allow' : 'ask'

    const value = matchValue(input)
    let action = globalRule === 'allow' ? 'allow' : 'ask'

    // 对象属性保持 JSON 中的顺序。后面的匹配会覆盖前面的结果，
    // 所以可以先写 "*": "ask"，再写更具体的 allow 规则。
    for (const [pattern, result] of Object.entries(toolRule)) {
        // bash 模式让 `*` 能匹配命令后的完整参数，包含 Windows 路径中的 `/`。
        if (picomatch.isMatch(value, pattern, { bash: true, dot: true })) {
            action = result === 'allow' ? 'allow' : 'ask'
        }
    }
    return action
}

const load = async ({ path }) => {
    const file = Bun.file(path)
    rules = await file.exists() ? await file.json() : { '*': 'ask' }
    return rules
}

const check = async ({ toolName, arguments: input = {}, onAsk }) => {
    const action = resolveAction({ toolName, input })
    if (action === 'allow') return true

    // Permission 不知道 SSE 或 sessionId。它只调用外部提供的询问函数，
    // 等前端作出决定后，把结果统一变成 true 或 false。
    if (typeof onAsk !== 'function') return false
    return Boolean(await onAsk({ toolName, arguments: input }))
}

const save = async ({ path }) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(rules, null, 2))
}

export default { load, check, save }
