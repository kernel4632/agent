/*
 * 工具审批：按权限规则放行工具，或在规则要求询问时等用户决定。
 *
 * 这是工具执行的唯一一道关口，所以忽略规则也在这里判断一次，读文件和执行命令都绕不过它。
 * 规则写在配置文件的 permission 字段里，规则为空时所有工具都先问用户。
 * 调用示例：
 *   const allowed = await Approval.check({ sessionId, messageId, toolCallId, toolName, input, signal })
 *   // allowed = true | false
 *   await Approval.decide({ sessionId, toolCallId, decision: 'allow-once' })
 *   // decision 只能是 allow-once / allow-always / deny
 */

import picomatch from 'picomatch'
import Config from '../commands/config.js' // 权限规则就写在配置里，不再单独存一份。
import Path from '../utils/path.js' // 记住"始终允许"后要写回配置文件。
import Ignore from './ignore.js' // 敏感文件不许碰，配置改不掉。
import Snapshot from './snapshot.js' // 工具改文件之前先存一份原样。
import Store from '../store.js' // 直接访问等待用户决定的审批表。
import SSE from '../utils/sse.js' // 把审批请求推给前端。
import fail from '../utils/fail.js' // 用户选了不认识的决定时按填错处理。

// --- 把工具参数压成一行文字 ---
const flatten = value => {
    // 规则里的模式要和参数对比，所以参数里的路径、命令都摊平成一行。
    const values = []
    const pending = [value]
    while (pending.length) {
        const current = pending.shift()
        if (Array.isArray(current)) pending.push(...current)
        else if (current && typeof current === 'object') pending.push(...Object.values(current))
        else values.push(String(current))
    }
    return values.join(' ')
}

// --- 按规则决定放行还是询问 ---
const decideByRules = (toolName, matchValue) => {
    // 没有规则时先问用户，不自动执行任何工具。
    const rules = Config.get().permission || { '*': 'ask' }
    const toolRule = rules[toolName]
    let action = rules['*'] === 'allow' ? 'allow' : 'ask' // 全局规则只是起点，具体工具可以覆盖它。

    if (typeof toolRule === 'string') action = toolRule === 'allow' ? 'allow' : 'ask' // 工具自己的规则优先。
    if (toolRule && typeof toolRule === 'object' && !Array.isArray(toolRule)) {
        // 对象形式的规则按参数匹配：最后一条命中的模式说了算。
        for (const [pattern, result] of Object.entries(toolRule)) {
            if (picomatch.isMatch(matchValue, pattern, { bash: true, dot: true })) action = result === 'allow' ? 'allow' : 'ask'
        }
    }
    return action
}
// 用户心里认为的"一个操作"：git commit -m "随便什么" 在他看来就是"提交"，
// 所以记住 git commit 这一个前缀就够，不必每换一条提交信息就重新问一遍。
// 写法参考 opencode 的 arity 表：参数丢掉，只留命令本身。
const COMMAND_PREFIXES = [
    'git commit', 'git checkout', 'git branch', 'git tag', 'git remote', 'git stash', 'git worktree',
    'git push', 'git pull', 'git fetch', 'git merge', 'git rebase', 'git reset', 'git add',
    'git log', 'git diff', 'git status', 'git show', 'git blame',
    'bun run', 'bun x', 'bun test', 'bun install', 'bun add', 'bun remove',
    'npm run', 'npm test', 'npm install', 'npm ci', 'npm publish',
    'yarn run', 'yarn add', 'pnpm run', 'pnpm add',
    'cargo run', 'cargo build', 'cargo test', 'cargo add', 'go run', 'go build', 'go test',
    'docker compose', 'docker run', 'docker build', 'kubectl get', 'kubectl apply',
    'pip install', 'python -m', 'uv run', 'poetry add', 'make',
]

// --- 把一条命令归一成"用户心里的那个操作" ---
const normalizeCommand = command => {
    // 命中最长的前缀就用它，都不命中时只留第一个词（比如 ls、pwd、dir）。
    const longest = COMMAND_PREFIXES.filter(prefix => String(command).startsWith(prefix)).sort((first, second) => second.length - first.length)[0]
    return longest || String(command).trim().split(/\s+/).slice(0, 1).join(' ')
}

// --- 把"始终允许"写成规则 ---
const remember = ({ toolName, input, matchValue }) => {
    // 命令工具按归一化后的前缀记；其他工具按完整参数记，允许读这个文件就只允许读这个文件。
    const pattern = toolName === 'shell' ? `${normalizeCommand(input.command)}*` : matchValue
    // 参数里可能出现通配符，先转义，保证这条规则只命中同一类参数。
    const escaped = pattern.replace(/[\\?[\]{()]/g, character => `[${character}]`)
    const rules = Config.get().permission
    const toolRule = rules[toolName]
    if (toolRule && typeof toolRule === 'object' && !Array.isArray(toolRule)) toolRule[escaped] = 'allow'
    else rules[toolName] = { '*': 'ask', [escaped]: 'allow' }
}

/**
 * 检查一个工具调用能不能执行；要改文件时，先把原样存一份进快照。
 *
 * 这是工具执行的唯一一道关口，忽略规则和权限规则都在这里判断，读文件和执行命令都绕不过它。
 * @param {{ sessionId: string, messageId?: string, toolCallId?: string, toolName: string, input?: object, signal?: AbortSignal }} call
 *   模型这次想调用的工具、参数和所在会话；没有 sessionId / toolCallId 时按无人值守放行。
 * @returns {Promise<boolean>} true 表示放行；false 表示被忽略规则拦下，或用户选择了拒绝。
 */
const check = async ({ sessionId, messageId, toolCallId, toolName, input = {}, signal }) => {
    // Agent 只看这个返回值是不是 true，所以这里必须返回布尔值，不能返回对象。
    // 被拦住的原因通过 SSE 告诉界面，让用户知道是哪条规则挡下的。
    const blocked = Ignore.blockedBy({ toolName, input })
    if (blocked) {
        await SSE.send({ id: sessionId, data: { type: 'permission-blocked', tool: toolName, input, reason: `被 .agentignore 规则挡住：${blocked}` } })
        return false
    }
    const matchValue = flatten(input)
    const rule = decideByRules(toolName, matchValue)

    // 改文件的工具在真正执行之前存一份原样，回退时才有东西可恢复。
    if (rule === 'allow') return allow({ sessionId, messageId, toolName, input })

    // 规则要求询问时，这里发出审批请求并等 Approval.decide 回答。
    if (!sessionId || !toolCallId) return allow({ sessionId, messageId, toolName, input }) // 没有会话上下文时按无人值守放行，避免任务卡死。

    const decision = await new Promise(resolve => {
        Store.approvals.set(`${sessionId}:${toolCallId}`, { sessionId, toolName, input, matchValue, resolve })
        SSE.send({ id: sessionId, data: { type: 'permission', callID: toolCallId, tool: toolName, input } })
        signal?.addEventListener('abort', () => {
            // 任务被取消时，这条审批永远不会有人回答，直接按拒绝处理并把 Agent 唤醒。
            Store.approvals.delete(`${sessionId}:${toolCallId}`)
            resolve(false)
        }, { once: true })
    })
    if (!decision) return false
    return allow({ sessionId, messageId, toolName, input })
}

// --- 放行并留下快照 ---
const allow = async ({ sessionId, messageId, toolName, input }) => {
    // 快照要在工具执行之前记录，记下的才是被修改之前的文件内容。
    await Snapshot.save({ sessionId, messageId, toolName, input })
    return true
}

// --- 列出这个会话还在等谁批准 ---
const pending = sessionId => {
    // 审批请求只通过 SSE 推一次。前端刷新或换设备打开同一个会话时，
    // 只有这里能告诉它"有个工具在等你"——否则会话看起来像卡住了。
    return [...Store.approvals.entries()]
        .filter(([, approval]) => approval.sessionId === sessionId)
        .map(([key, approval]) => ({ callID: key.slice(sessionId.length + 1), tool: approval.toolName, input: approval.input }))
}
/**
 * 接收用户在界面上做的决定，唤醒正在等待的那次工具调用。
 * @param {{ sessionId: string, toolCallId: string, decision: 'allow-once'|'allow-always'|'deny' }} choice
 *   用户点的按钮；不认识的取值按填错处理（400）。
 * @returns {Promise<{ ok: boolean }>} false 表示这条审批已经结束或不存在，界面不该显示为成功。
 */
const decide = async ({ sessionId, toolCallId, decision }) => {
    const approval = Store.approvals.get(`${sessionId}:${toolCallId}`)
    if (!approval) return { ok: false } // 已经超时或被取消的审批不再处理。
    if (!['allow-once', 'allow-always', 'deny'].includes(decision)) throw fail(400, `decision must be allow-once, allow-always or deny, got: ${decision}`)

    Store.approvals.delete(`${sessionId}:${toolCallId}`)
    if (decision === 'allow-always') {
        // 记住这类参数，并把规则写回配置文件，重启后依然生效。
        remember({ toolName: approval.toolName, input: approval.input, matchValue: approval.matchValue })
        await Config.save(Path.config())
    }
    approval.resolve(decision !== 'deny') // 允许一次和始终允许都放行本次调用。
    return { ok: true }
}

export default { check, decide, pending }
