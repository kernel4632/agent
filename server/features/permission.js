/* 
目标被调用形式（绝对不可修改）：
// 1. 加载规则
await Permission.load({
    path: "/path/to/permission.json",
})

// 2. 检查权限，规则为 ask 时自动向前端询问三种决定
const result = await Permission.check({
    sessionId: "session-1",
    callId: "call-1",
    toolName: "edit",              // 工具名
    arguments: {                   // 工具参数，用于匹配
        path: "src/index.js",
    },
})
// result = true | false

// 3. 前端提交审批决定
await Permission.decide({
    sessionId: "session-1",
    callId: "call-1",
    decision: "allow-once", // allow-always / allow-once / deny
})

// 4. 保存规则
await Permission.save({
    path: "/path/to/permission.json",
})
*/

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically'
import picomatch from 'picomatch'
import SSE from '../utils/sse.js'

// 没有规则文件时，所有工具都先询问用户，不会自动执行。
let rules = { '*': 'ask' }
let permissionPath = null
let configFile = false
const approvals = new Map()

const load = async ({ path }) => {
    const file = Bun.file(path)
    const data = await file.exists() ? await file.json() : { '*': 'ask' }
    // 既支持单独的权限文件，也支持从完整 config.json 读取 permission 字段。
    configFile = Boolean(data.permission)
    rules = data.permission || data
    permissionPath = path
    return rules
}

const check = async ({ sessionId, callId, toolName, arguments: input = {}, signal }) => {
    const values = []
    const pending = [input]
    while (pending.length) {
        const value = pending.shift()
        if (Array.isArray(value)) pending.push(...value)
        else if (value && typeof value === 'object') pending.push(...Object.values(value))
        else values.push(String(value))
    }
    const matchValue = values.join(' ')
    const globalRule = rules['*']
    const toolRule = rules[toolName]
    let action = globalRule === 'allow' ? 'allow' : 'ask'
    if (typeof toolRule === 'string') action = toolRule === 'allow' ? 'allow' : 'ask'
    if (toolRule && typeof toolRule === 'object' && !Array.isArray(toolRule)) {
        for (const [pattern, result] of Object.entries(toolRule)) {
            if (picomatch.isMatch(matchValue, pattern, { bash: true, dot: true })) {
                action = result === 'allow' ? 'allow' : 'ask'
            }
        }
    }
    if (action === 'allow') return true // 已有规则直接放行，不打扰外部。

    // 规则需要询问时，Permission 直接通知前端并等待 Permission.decide。
    if (!sessionId || !callId) return true
    const decision = await new Promise(resolve => {
        // Permission 自己负责发起询问并等待 decide，不把等待细节交给 Agent。
        approvals.set(`${sessionId}:${callId}`, { sessionId, resolve, toolName, input, matchValue, toolRule })
        SSE.send({
            id: sessionId,
            data: { type: 'permission', callID: callId, tool: toolName, input },
        })
        signal?.addEventListener('abort', () => {
            approvals.delete(`${sessionId}:${callId}`)
            resolve(false)
        }, { once: true })
    })
    return decision
}

const decide = async ({ sessionId, callId, decision }) => {
    const approval = approvals.get(`${sessionId}:${callId}`)
    if (!approval || approval.sessionId !== sessionId) return { ok: false }
    approvals.delete(`${sessionId}:${callId}`)
    if (decision === 'allow-always') {
        const pattern = approval.matchValue.replace(/[\\*?\[\]{}()]/g, character => ({
            '\\': '[\\\\]', '*': '[*]', '?': '[?]', '[': '[[]', ']': '[]]',
            '{': '[{]', '}': '[}]', '(': '[(]', ')': '[)]',
        }[character]))
        if (approval.toolRule && typeof approval.toolRule === 'object' && !Array.isArray(approval.toolRule)) approval.toolRule[pattern] = 'allow'
        else rules[approval.toolName] = { '*': 'ask', [pattern]: 'allow' }
        if (permissionPath) await save({ path: permissionPath })
    }
    approval.resolve(decision === 'deny' || decision === false ? false : true)
    return { ok: true }
}

const save = async ({ path }) => {
    await mkdir(dirname(path), { recursive: true })
    const data = configFile && await Bun.file(path).exists() ? await Bun.file(path).json() : rules
    await writeFile(path, JSON.stringify(configFile ? { ...data, permission: rules } : data, null, 2))
}

export default { load, check, decide, save }
