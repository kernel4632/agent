/*
任务引导（实验性，验证成熟后拟并入 agent-core）：框架的教练，专为 textTools 弱模型设计。

两个职责：
1. 干活导向的系统提示：弱模型默认会「勘察环境」而不会直接产出。首轮注入工作方法——
   先计划、直接写成品、写完用 finish 结束；并告知沙箱目录在哪（write_file 的相对路径落点）。
2. 打转检测与纠偏：观察每轮 step 事件的调用签名（工具名 + 参数）与正文；
   - 连续 N 次完全相同的调用 → 一级纠偏：告诉它重复了、结果一致，引导改变策略直接产出；
   - 纠偏后仍重复 → 二级纠偏：更强硬的指令，点名要它立即写成品；
   - 二级之后仍重复 → 注入收尾令：要求它调用 finish（工具返回 stop:true，循环自然结束）。
   不直接终止 run：引导优先，收尾令是最后手段（模型自己调 finish，仍是「它完成」的形状）。
状态挂在内存 Map（会话 id → 观察记录）；重启丢失观察无妨，历史里没有打转证据时它本来也不该纠偏。
*/

/** @param {import('agent-backend').Ctx} ctx */
export default ctx => {
    const seen = new Map()          // id → { signatures, texts, stage, cooldown }
    /** @param {string} id */
    const state = id => {
        if (!seen.has(id)) seen.set(id, { signatures: [], texts: [], stage: 0, cooldown: 0 })
        return seen.get(id)
    }
    const SIGNATURE_LIMIT = 6       // 只看最近几轮，防止长任务里的合理重复被误伤
    const REPEAT_THRESHOLD = 3      // 窗口内去重后只剩 ≤2 种动作、且都出现过 ≥3 次，算打转（连击和钟摆都抓）
    const COOLDOWN_ROUNDS = 3       // 纠偏注入后的冷却轮数：注入会打破模型缓存，连续注入等于每轮重写 prompt
    // 查看类工具：产出为零。连续 LOOK_LIMIT 轮全是查看类（无论在几个工具间轮换）也算勘察打转——
    // 任务 4 实录：71 次 read_file 在 7 个路径间轮转，种类检测（≤2）抓不住。勘察任务的正常轮数远低于此（任务 5 实录 3 轮收工）。
    const LOOK_TOOLS = new Set(['read_file', 'list_dir', 'skill', 'webfetch', 'todo'])
    const LOOK_LIMIT = 8
    // 产出动词：首个用户消息里出现时，勘察打转检测才生效——勘察型任务（「看看/总结」）不该被引导去写文件（任务 5 实录误伤）。
    const OUTPUT_WORDS = /写|修|改|创建|生成|保存|存成|导出|实现|开发|部署|安装/i

    /** @param {string[]} list */
    const isLooking = (list) => {
        const window = list.slice(-LOOK_LIMIT)
        return window.length >= LOOK_LIMIT && window.every(/** @param {string} sig */ sig => sig.split(';').every(/** @param {string} one */ one => LOOK_TOOLS.has(JSON.parse(one).toolName)))
    }

    // 会话的首个用户消息是否要求产出：决定勘察检测是否启用。
    /** @param {string} id */
    const wantsOutput = (id) => {
        const first = ctx.Agents.get(id)?.agent.history.find(message => message.role === 'user')
        const text = typeof first?.content === 'string' ? first.content : Array.isArray(first?.content) ? first.content.map(p => p?.text ?? '').join('') : ''
        return OUTPUT_WORDS.test(text)
    }

    /** @param {string[]} list */
    const sameTail = (list) => {
        const window = list.slice(-SIGNATURE_LIMIT)
        if (window.length < REPEAT_THRESHOLD * 2) return false       // 样本太少不判定
        const counts = new Map()
        for (const one of window) counts.set(one, (counts.get(one) ?? 0) + 1)
        if (counts.size > 2) return false                            // 窗口里动作种类多于 2 种：还在探索，不打扰
        return [...counts.values()].every(count => count >= REPEAT_THRESHOLD)   // 一两种动作反复出现（连击 / 钟摆）就是打转
    }

    ctx.patch(ctx.Agents, 'callbacks', /** @param {(id: string) => Record<string, any>} original */ original => id => {
        const base = original(id)
        const onEvent = base.onEvent
        const onInject = base.onInject
        return {
            ...base,
            /** @param {any} event */
            onEvent(event) {
                const result = onEvent?.(event)
                if (event.type === 'step') {
                    const note = state(id)
                    const calls = event.reply?.toolCalls ?? []
                    const signature = calls.map(/** @param {any} call */ call => JSON.stringify({ toolName: call.toolName, input: call.input })).sort().join(';') || `(无调用)`
                    note.signatures.push(signature)
                    note.signatures = note.signatures.slice(-SIGNATURE_LIMIT)
                    const text = String(event.reply?.text ?? '').trim()
                    if (text) {
                        note.texts.push(text)
                        note.texts = note.texts.slice(-SIGNATURE_LIMIT)
                    }
                }
                return result
            },
            /** @param {unknown} info */
            async onInject(info) {
                const prior = await onInject?.(info)
                const note = state(id)
                const started = ctx.Agents.get(id)?.agent.history.some(message => message.role === 'user') ?? false
                const blocks = []

                // 1. 干活导向：首轮注入工作方法 + 沙箱位置。
                //    TODO（设置页一并迁移）：稳定文本应走 config.system（每轮生效且不破缓存），注入只是过渡方案。
                if (!started) {
                    blocks.push([
                        '工作方法（重要）：',
                        '- 收到任务后先想一步计划，然后直接开始产出成品（写文件、写代码），不要反复勘察环境。',
                        '- 工具结果会原样返回给你；同一个调用重复执行会得到相同结果，信息拿一次就够。',
                        '- write_file 用相对路径（如 index.html）会落在沙箱工作区，可以直接写；父目录不存在会自动创建。',
                        '- 一次 write_file 就写完整内容；内容太长被截断时，把成品拆成多个文件分别写。',
                        '- 完成任务后立即调用 finish 工具结束；不要在完成后继续调用任何工具。',
                        '- 任务要求多个文件时，逐个写完每一个再结束。',
                    ].join('\n'))
                }

                // 2. 打转检测 → 逐级纠偏；窗口里出现新动作（探索恢复 / 开始产出）就降级复位。
                //    注入纪律：纠偏语会变成临时 user 消息、打破模型缓存——命中后强制冷却 COOLDOWN_ROUNDS 轮，
                //    给模型消化时间；冷却中不注入，冷却耗尽仍在打转才升下一级（冷却末轮直接注入，不空等）。
                // 撞墙检测不受任务类型门控：即使勘察任务，反复调用被拒绝的工具也必须制止（任务 5 实录 shell×24 撞 deny）。
                /** @param {string} toolName @returns {string | undefined} 最近一次该工具的失败/拒绝原因 */
                const whyBlocked = (toolName) => {
                    const history = ctx.Agents.get(id)?.agent.history ?? []
                    for (const message of [...history].reverse()) {
                        if (message.role !== 'tool') continue
                        for (const part of Array.isArray(message.content) ? message.content : []) {
                            if (part.type !== 'tool-result' || part.toolName !== toolName) continue
                            const type = String(part.output?.type ?? '')
                            if (type.startsWith('error') || type === 'execution-denied') return String(part.output?.value ?? part.output?.reason ?? '调用失败')
                        }
                        return undefined        // 这个工具最近一次是成功的：没被拦
                    }
                    return undefined
                }
                const blocked = sameTail(note.signatures) && note.signatures.at(-1)?.split(';').map(/** @param {string} one */ one => JSON.parse(one)).some(/** @param {any} c */ c => whyBlocked(c.toolName))
                const repeating = blocked || sameTail(note.signatures) || sameTail(note.texts) || (wantsOutput(id) && isLooking(note.signatures))
                let nudge = false                     // 本轮要不要注入引导语
                if (note.cooldown > 0) {
                    note.cooldown -= 1
                    if (note.cooldown === 0 && repeating) { if (note.stage < 2) note.stage += 1; nudge = true }
                } else if (repeating) {
                    note.stage = Math.min(note.stage + 1, 2)
                    nudge = true
                } else if (note.stage && note.signatures.length >= 2) {
                    note.stage = 0                    // 窗口里出现了新动作：模型已恢复，降级复位
                }
                if (nudge) {
                    if (blocked) {
                        // 撞墙引导：点破「这个工具不可用」——弱模型读不懂「被用户拒绝」，要直说这个工具已被禁用
                        const tool = note.signatures.at(-1)?.split(';').map(/** @param {string} one */ one => JSON.parse(one)).find(/** @param {any} c */ c => whyBlocked(c.toolName))
                        const why = tool ? whyBlocked(tool.toolName) : '被拒绝'
                        blocks.push(`[下一步指令] 工具 ${tool?.toolName ?? ''} 已被禁用（${why}），之后也不能用它。继续完成任务本身：根据已有信息直接给出结果或改用可用的工具。`)
                    } else if (note.stage === 1) {
                        // 失败引导：指名道姓说清哪次调用坏了、下一步的输出物是什么。
                        // 弱模型提示词铁律：不说否定句（复读会强化错误），只给下一步的肯定指令；短；给可照抄的格式。
                        const history = ctx.Agents.get(id)?.agent.history ?? []
                        const lastResults = history.filter(m => m.role === 'tool').slice(-LOOK_LIMIT)
                        const bad = lastResults.flatMap(m => Array.isArray(m.content) ? m.content.filter(p => p.type === 'tool-result') : []).find(p => {
                            const type = String(p.output?.type ?? '')
                            return type.startsWith('error') || type === 'execution-denied' || /拒绝|denied|找不到|不存在|不能为空/i.test(String(p.output?.value ?? p.output?.reason ?? ''))
                        })
                        if (bad) {
                            const why = String(bad.output?.value ?? bad.output?.reason ?? '调用失败').slice(0, 120)
                            blocks.push(`[下一步指令] ${bad.toolName} 的调用失败了：${why}。换用 write_file 工具直接写出任务成品，格式照抄：\n\n<tool_call>\n{"name": "write_file", "arguments": {"path": "文件名", "content": "任务成品的完整内容"}}\n</tool_call>`)
                        } else {
                            blocks.push('[下一步指令] 你已经收集了足够的信息。现在输出一个 write_file 调用把任务成品写进文件，格式照抄：\n\n<tool_call>\n{"name": "write_file", "arguments": {"path": "文件名", "content": "任务成品的完整内容"}}\n</tool_call>\n\n写完文件后输出 finish 调用结束。')
                        }
                    } else {
                        blocks.push('[下一步指令] 现在只需要两个调用：先输出 write_file 调用写出任务成品，然后输出 finish 调用结束。文件路径用简单文件名（如 result.txt）。照抄格式：\n\n<tool_call>\n{"name": "write_file", "arguments": {"path": "result.txt", "content": "...内容..."}}\n{"name": "finish", "arguments": {}}\n</tool_call>')
                    }
                    note.signatures = []        // 清观察：进入冷却，给引导语一轮以上的生效窗口
                    note.texts = []
                    note.cooldown = COOLDOWN_ROUNDS
                }
                return [prior, ...blocks].filter(Boolean).join('\n\n')
            },
        }
    })
}
