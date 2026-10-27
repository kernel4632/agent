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
import Config from '../config/config.js' // 权限规则就写在配置里，不再单独存一份。
import Settings from '../config/settings.js' // 自动批准是按类别分的，判断逻辑只写在那里。
import Boundary from './boundary.js' // 工作区外的路径要单独过 external_directory 规则。
import Kind from '../utils/tool-kind.js' // 内部工具不参与审批，也不该被 deny 规则拦住。
import Path from '../utils/path.js' // 记住"始终允许"后要写回配置文件。
import Ignore from './ignore.js' // 敏感文件不许碰，配置改不掉。
import Snapshot from '../session/snapshot.js' // 工具改文件之前先存一份原样。
import Store from '../store.js' // 直接访问等待用户决定的审批表和会话设置。
import SSE from '../utils/sse.js' // 把审批请求推给前端。
import fail from '../utils/fail.js' // 用户选了不认识的决定时按填错处理。
import { canonical, previousNames } from '../utils/tool-names.js' // 新名字生效，旧权限规则继续认。

// 同一个工具调用连续出现这么多次，就停下来问一次。
// 模型跑偏的典型表现不是"做了一件坏事"，而是"同一件小事反复重试"。
const LOOP_LIMIT = 3

/**
 * 把参数变成稳定的字符串，键的顺序不影响结果。
 * @param {unknown} value 模型的原始参数。
 * @returns {string} 用来判断"是不是同一个调用"的键。
 */
const stableKey = value => {
    if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableKey(value[key])}`).join(',')}}`
    }
    return JSON.stringify(value)
}

/**
 * 把工具参数摊平成一行文字，供规则里的模式去比对。
 * 路径、命令、嵌套对象都会被摊开，所以规则写 `git commit*` 就能命中。
 * @param {unknown} value 模型的原始参数。
 * @returns {string} 摊平后的一行。
 */
const flattenInput = value => {
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

/**
 * 把规则里的动作夹到三种合法值里。
 * 认不出的写法一律按"询问"处理，不能因为写错一个词就悄悄放行。
 * @param {unknown} value 规则里写的动作。
 * @returns {'allow'|'ask'|'deny'} 规范化后的动作。
 */
const normalize = value => value === 'allow' ? 'allow' : value === 'deny' ? 'deny' : 'ask'

/**
 * 按规则决定放行、询问还是拒绝。
 * @param {string} toolName 工具名。
 * @param {string} matchValue 摊平后的参数。
 * @param {object} [rules] 生效的权限规则；不传时用全局规则。
 * @returns {'allow'|'ask'|'deny'} 全局规则只是起点，具体工具的规则可以覆盖它。
 */
const decideByRules = (toolName, matchValue, rules = Config.get().permission || { '*': 'ask' }) => {
    // 没有规则时先问用户，不自动执行任何工具。
    const name = canonical(toolName)
    // 先看新名字，再看旧名字；用户的旧 permission 配置不会因为改名失效。
    const toolRule = [name, ...previousNames(name)].map(item => rules[item]).find(rule => rule !== undefined)
    let decision = normalize(rules['*'])
    if (typeof toolRule === 'string') decision = normalize(toolRule) // 工具自己的规则优先。
    if (toolRule && typeof toolRule === 'object' && !Array.isArray(toolRule)) {
        // 对象形式的规则按参数匹配：最后一条命中的模式说了算。
        for (const [pattern, result] of Object.entries(toolRule)) {
            if (picomatch.isMatch(matchValue, pattern, { bash: true, dot: true })) decision = normalize(result)
        }
    }
    return decision
}

/**
 * 这次会话实际生效的权限规则：全局规则打底，智能体自己的 permission 覆盖同名项。
 * 智能体没有权限覆盖时直接用全局规则，行为与旧版本完全一致。
 * @param {object} [settings] 会话设置。
 * @returns {object} 合并后的规则。
 */
const effectiveRules = settings => {
    const global = Config.get().permission || { '*': 'ask' }
    const agent = Settings.agentInfo(settings?.agent)?.permission
    return agent ? { ...global, ...agent } : global
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

/**
 * 把一条命令归一成"用户心里的那个操作"。
 * @param {string} command 模型要执行的整条命令。
 * @returns {string} 命中最长的前缀就用它，都不命中时只留第一个词（比如 ls、pwd、dir）。
 */
const normalizeCommand = command => {
    const longest = COMMAND_PREFIXES.filter(prefix => String(command).startsWith(prefix)).sort((first, second) => second.length - first.length)[0]
    return longest || String(command).trim().split(/\s+/).slice(0, 1).join(' ')
}

// --- 配置里的对象；写坏或缺失时换成一个新的空对象 ---
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null

// --- 找到"始终允许"该写进哪张规则表：智能体自己的规则优先，否则写全局 ---
const writableRules = ({ agent }) => {
    const config = Config.get()
    // 智能体已经单独配了规则时，只改它自己那份，不污染全局。
    const agentRules = agent ? Settings.agentInfo(agent)?.permission : null
    if (agentRules && Object.keys(agentRules).length) {
        config.agents = plainObject(config.agents) || {}
        config.agents[agent] = plainObject(config.agents[agent]) || {}
        config.agents[agent].permission = plainObject(config.agents[agent].permission) || {}
        return config.agents[agent].permission
    }
    config.permission = plainObject(config.permission) || { '*': 'ask' }
    return config.permission
}

/**
 * 把"始终允许"写成一条规则。
 * 命令工具按归一化后的前缀记；其他工具按完整参数记，允许读这个文件就只允许读这个文件。
 * 当前智能体有自己的 permission 时写进智能体，否则写回全局规则。
 * @param {{ toolName: string, input: object, matchValue: string, agent?: string }} call
 * @returns {void}
 */
const remember = ({ toolName, input, matchValue, agent }) => {
    const name = canonical(toolName)
    const pattern = name === 'execute_command' ? `${normalizeCommand(input.command)}*` : matchValue
    // 参数里可能出现通配符，先转义，保证这条规则只命中同一类参数。
    const escaped = pattern.replace(/[\\?[\]{()]/g, character => `[${character}]`)
    const rules = writableRules({ agent })
    const toolRule = plainObject(rules[name])
    if (toolRule) toolRule[escaped] = 'allow'
    else rules[name] = { '*': 'ask', [escaped]: 'allow' }
}

/**
 * 放行这次调用，并在工具真正执行之前把要改的文件存一份快照。
 * 记录里同时留下消息 id 和工具调用 id，所以既能退回整轮对话，也能只退回这一次调用。
 * @param {{ sessionId: string, messageId?: string, toolCallId?: string, toolName: string, input: object }} call
 * @returns {Promise<boolean>} 恒定 true，配合 check 的返回值使用。
 */
const allow = async ({ sessionId, messageId, toolCallId, toolName, input }) => {
    const name = canonical(toolName)
    // 快照要在工具执行之前记录，记下的才是被修改之前的文件内容。
    // execute_command 不知道会改哪些文件，所以先把整个工作区备份一份；命令结束后再对比。
    if (name === 'execute_command') {
        try {
            await Snapshot.beginShell({ sessionId, messageId, toolCallId })
        } catch {
            // 快照失败不该把工具挡下来；没有快照只是少一层回退保护。
        }
    } else {
        await Snapshot.save({ sessionId, messageId, toolCallId, toolName: name, input })
    }
    return true
}

// --- 被忽略规则挡住时，把原因告诉界面 ---
const blockedByIgnore = async ({ sessionId, name, input }) => {
    const blocked = Ignore.blockedBy({ toolName: name, input })
    if (!blocked) return false
    await SSE.send({ id: sessionId, data: { type: 'permission-blocked', tool: name, input, reason: `被 .agentignore 规则挡住：${blocked}` } })
    return true
}

// --- 这次会话生效的规则：全局 permission 打底，当前智能体的 permission 覆盖同名项 ---
const ruleDecision = async ({ sessionId, name, matchValue, input }) => {
    const settings = Store.settings.get(sessionId)
    const decision = decideByRules(name, matchValue, effectiveRules(settings))
    if (decision !== 'deny') return { settings, decision, denied: false }
    if (sessionId) await SSE.send({ id: sessionId, data: { type: 'permission-blocked', tool: name, input, reason: '被权限规则拒绝' } })
    return { settings, decision, denied: true }
}

// --- 工作区外的路径单独过一道 external_directory 规则；默认是 ask ---
const outsideWorkspace = async ({ sessionId, name, input }) => {
    const external = await Boundary.check({ toolName: name, input })
    if (external.effect === 'deny') {
        if (sessionId) await SSE.send({ id: sessionId, data: { type: 'permission-blocked', tool: name, input, reason: `路径在工作区外，且被 external_directory 规则拒绝：${external.paths[0]}` } })
        return { denied: true, ask: false }
    }
    return { denied: false, ask: external.effect === 'ask' }
}

// --- 同一个调用连续出现时先停下来问一次 ---
const repeatsTooOften = ({ sessionId, name, input }) => {
    if (!sessionId) return false
    const key = `${name}:${stableKey(input)}`
    const previous = Store.recentCalls.get(sessionId)
    const count = previous?.key === key ? previous.count + 1 : 1
    Store.recentCalls.set(sessionId, { key, count })
    const looping = count >= LOOP_LIMIT
    if (looping) {
        SSE.send({ id: sessionId, data: { type: 'permission-limit', limit: LOOP_LIMIT, reason: `同一个工具调用连续出现 ${LOOP_LIMIT} 次，确认要继续吗` } })
    }
    return looping
}

// --- 这一类开了自动批准就跳过询问，但连着放行太多次要停下来问一次 ---
const autoApproveState = ({ sessionId, settings, name, mcpServers }) => {
    const auto = Settings.approves({ settings, toolName: name, mcpServers })
    const limit = settings?.autoApproveLimit || 0
    const used = Store.autoApproved.get(sessionId) || 0
    const capped = auto && limit > 0 && used >= limit
    if (auto && !capped) Store.autoApproved.set(sessionId, used + 1)
    if (!capped) return { auto, capped }
    /*
     * 告诉用户为什么突然又要他点了，不然会以为自动批准坏了。
     *
     * 这里不能 await：这一句后面紧跟着登记审批、等用户决定，
     * 而调用方（agent-core）拿到的是一个"还没登记"的 promise。
     * 一旦在这里让出微任务，审批就晚一步才进队列，界面上什么都看不到——
     * 用户看到的是"卡住了"，而 agent 就在那里一直等一个永远不会来的回答。
     * SSE 的 send 本来只是往缓冲区里放一条，不 await 也照样按顺序发出去。
     */
    SSE.send({ id: sessionId, data: { type: 'permission-limit', limit, reason: `已连续自动批准 ${limit} 次，确认要继续吗` } })
    return { auto, capped }
}

// --- 把审批请求推给界面，等用户回答；任务被取消时按拒绝处理 ---
const waitForUser = ({ sessionId, toolCallId, name, input, matchValue, signal }) => new Promise(resolve => {
    Store.approvals.set(`${sessionId}:${toolCallId}`, { sessionId, toolName: name, input, matchValue, resolve })
    SSE.send({ id: sessionId, data: { type: 'permission', callID: toolCallId, tool: name, input } })
    signal?.addEventListener('abort', () => {
        // 任务被取消时，这条审批永远不会有人回答，直接按拒绝处理并把 Agent 唤醒。
        Store.approvals.delete(`${sessionId}:${toolCallId}`)
        resolve(false)
    }, { once: true })
})

/**
 * 检查一个工具调用能不能执行；要改文件时，先把原样存一份进快照。
 *
 * 这是工具执行的唯一一道关口，忽略规则和权限规则都在这里判断，读文件和执行命令都绕不过它。
 * @param {{ sessionId: string, messageId?: string, toolCallId?: string, toolName: string, input?: object, signal?: AbortSignal }} call
 *   模型这次想调用的工具、参数和所在会话；没有 sessionId / toolCallId 时按无人值守放行。
 * @returns {Promise<boolean>} true 表示放行；false 表示被忽略规则拦下，或用户选择了拒绝。
 */
const check = async ({ sessionId, messageId, toolCallId, toolName, input = {}, signal }) => {
    // Agent 只看这个返回值是不是布尔值，所以这里必须返回布尔值，不能返回对象。
    // 被拦住的原因通过 SSE 告诉界面，让用户知道是哪条规则挡下的。
    const name = canonical(toolName)
    if (await blockedByIgnore({ sessionId, name, input })) return false

    const matchValue = flattenInput(input)
    const mcpServers = Object.keys(Config.get().mcp || {})
    /*
     * 内部工具（记清单、结束循环）不碰磁盘也不碰外部服务，没有"要不要批准"这回事。
     * 这一步放在 deny 之前：用户写 "*": "deny" 时，循环本身仍然要能收尾。
     */
    if (Kind.of({ toolName: name, mcpServers }) === 'never') return allow({ sessionId, messageId, toolCallId, toolName: name, input })

    /*
     * deny 是硬规则。自动批准只省掉"询问"，不能把一条明确的拒绝变成放行——
     * 用户写下 "execute_command": "deny" 之后，即使命令类全开着，也不该执行。
     */
    const rules = await ruleDecision({ sessionId, name, matchValue, input })
    if (rules.denied) return false
    const settings = rules.settings
    const external = await outsideWorkspace({ sessionId, name, input })
    if (external.denied) return false

    /*
     * 两种刹车都要压过"规则说 allow"：
     *   - 同一个调用连续重复；
     *   - 自动批准已经连着放行了太多次。
     * 否则用户写了 "*": "allow" 之后，刹车就成了摆设。
     */
    const looping = repeatsTooOften({ sessionId, name, input })
    const auto = autoApproveState({ sessionId, settings, name, mcpServers })
    const rule = looping || auto.capped || external.ask ? 'ask' : auto.auto ? 'allow' : rules.decision
    // 改文件的工具在真正执行之前存一份原样，回退时才有东西可恢复。
    if (rule === 'allow') return allow({ sessionId, messageId, toolCallId, toolName: name, input })

    // 规则要求询问时，这里发出审批请求并等 Approval.decide 回答。
    // 没有会话上下文时按无人值守放行；但工作区外的路径不能这样静默放行。
    if (!sessionId || !toolCallId) return external.ask ? false : allow({ sessionId, messageId, toolCallId, toolName: name, input })

    const answer = await waitForUser({ sessionId, toolCallId, name, input, matchValue, signal })
    if (!answer) return false
    return allow({ sessionId, messageId, toolCallId, toolName: name, input })
}

/**
 * 列出这个会话还在等谁批准。
 * @param {string} sessionId 会话编号。
 * @returns {Array<{ callID: string, tool: string, input: object }>} 待批准的调用；没有时是空数组。
 * @remarks 审批请求只通过 SSE 推一次。前端刷新或换设备打开同一个会话时，
 *   只有这里能告诉它"有个工具在等你"——否则会话看起来像卡住了。
 */
const pending = sessionId => {
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
    // 用户刚看过一眼，重复调用的计数也重新开始。
    Store.recentCalls.delete(sessionId)
    /*
     * 用户答过一次之后重新计数。
     * 他刚看过一眼并说了继续，接下来这 N 次就当是新的开始——
     * 不然计数一到顶就再也回不去，自动批准等于永久失灵。
     */
    if (decision !== 'deny') Store.autoApproved.set(sessionId, 0)
    if (decision === 'allow-always') {
        // 记住这类参数，并把规则写回配置文件，重启后依然生效。
        // 当前智能体有自己的权限覆盖时写进智能体，避免改了全局却仍被智能体规则拦住。
        const agent = Store.settings.get(sessionId)?.agent
        remember({ toolName: approval.toolName, input: approval.input, matchValue: approval.matchValue, agent })
        await Config.save(Path.config())
    }
    approval.resolve(decision !== 'deny') // 允许一次和始终允许都放行本次调用。
    return { ok: true }
}

export default { check, decide, pending }
