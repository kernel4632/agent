/*
 * 会话运行设置测试：智能体（plan / build）、按类别的自动批准、能力开关。
 *
 * 这三项都会改变 agent 实际拿到的东西（工具表、config），所以每条都要真的读回
 * 建好的 Agent 来验证，而不是只看接口返回了什么。
 * 自动批准要能一类一类地开关：开着"读取"不等于放行"写入"和"执行命令"，
 * 所以每条用例都同时看"这一类过没过"和"别类是不是还在问"。
 * 每个测试在自己的临时数据目录里跑，互不影响。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Agent from '@kernel4632/agent-core'
import Approval from '../features/approval.js'
import Config from '../commands/config.js'
import Delegation from '../features/delegation.js'
import History from '../features/history.js'
import Path from '../utils/path.js'
import Settings from '../commands/settings.js'
import Session from '../commands/session.js'
import Store from '../store.js'
import Title from '../features/title.js'
import { app } from '../server.js'

// 每类都关掉的那份默认值，断言里要用。
const allOff = () => Object.fromEntries(Settings.KINDS.map(item => [item.kind, false]))

// 每类都打开的那份，用来验证"全开"不改变需要批准这个行为。
const allOn = () => Object.fromEntries(Settings.KINDS.map(item => [item.kind, true]))

// 每个测试使用独立目录和干净的内存数据。
const withHome = async callback => {
    const root = join(tmpdir(), `agent-settings-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Object.keys(Store.config).forEach(key => delete Store.config[key])
    Store.agents.clear()
    Store.sessions.clear()
    Store.snapshots.clear()
    Store.approvals.clear()
    Store.settings.clear()
    Store.autoApproved.clear()
    try {
        return await callback(root)
    } finally {
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(root, { recursive: true, force: true })
    }
}

// 直接建一条会话，省得每个测试重复写。
// extra 用来补配置里要多出来的部分（比如 MCP 服务），默认的权限规则是"全部先问"。
const newSession = async ({ title = '设置测试', extra = {} } = {}) => {
    // 设置测试不依赖真实工作区里的 AGENTS.md，关掉规则读取保持用例独立。
    await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'ask' }, rules: { enabled: false }, ...extra })
    const { sessionId } = await Session.create({ title })
    return sessionId
}

// 看某个会话当前建出来的 Agent 手里有哪些工具。
const toolNames = sessionId => Object.keys(Store.agents.get(sessionId).tools.schema).sort()

/*
 * 走一次审批，返回这次是直接放行还是要问用户。
 * 需要问的时候这里替用户拒绝掉，把那条等待解开——不然它会一直挂着，测试也看不出结果。
 */
const runCheck = async ({ sessionId, toolCallId, toolName, input = {} }) => {
    const result = Approval.check({ sessionId, toolCallId, toolName, input })
    // 审批前还要过工作区边界（可能是异步的），等一个微任务再看向队列。
    await Bun.sleep(0)
    const asked = Store.approvals.has(`${sessionId}:${toolCallId}`)
    if (asked) await Approval.decide({ sessionId, toolCallId, decision: 'deny' })
    return { allowed: await result, asked }
}

describe('会话运行设置', () => {
    test('默认是 build 智能体、每类自动批准全关、能力全开', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const settings = await Session.readSettings({ sessionId })
            // 除了自动批准那两档刹车，其余默认值和 agent-core 一致，做到"默认全原生"。
            // 刹车默认给一个宽松但有数的档：已经开了自动批准，完全不设上限跑飞了就是真花钱。
            expect(settings).toEqual({
                agent: 'build',
                autoApprove: allOff(),
                autoApproveLimit: 50,
                compactThreshold: 0.8,
                capabilities: { image: true, cache: true, stream: true },
                uses: {},        // 空对象＝每件事都用主模型，这是绝大多数人的用法
                autoTitle: true, // 第一次聊完自动起标题
            })
        })
    })

    test('plan 智能体只给只读工具，build 智能体给全套', async () => {
        await withHome(async () => {
            const sessionId = await newSession()

            // build 智能体下能改文件的工具都在。
            const buildTools = toolNames(sessionId)
            expect(buildTools).toContain('write_to_file')
            expect(buildTools).toContain('execute_command')
            expect(buildTools).toContain('apply_patch')

            // 切到 plan 之后，能改文件的工具一个都不该剩下。
            await Session.saveSettings({ sessionId, agent: 'plan' })
            const planTools = toolNames(sessionId)
            expect(planTools).not.toContain('write_to_file')
            expect(planTools).not.toContain('edit')
            expect(planTools).not.toContain('apply_patch')
            expect(planTools).not.toContain('execute_command')
            // 看和查的工具要留着，不然 plan 智能体什么都干不了。
            expect(planTools).toContain('read_file')
            expect(planTools).toContain('search_files')
            expect(planTools).toContain('glob')
            // 子任务本身不算"能改磁盘"，plan 智能体里留着。
            expect(planTools).toContain('new_task')

            // 切回 build 又能改文件了。
            await Session.saveSettings({ sessionId, agent: 'build' })
            expect(toolNames(sessionId)).toContain('write_to_file')
        })
    })

    test('plan 智能体不通过系统提示词约束，system 只保留默认提示词', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, agent: 'plan' })
            // 靠的是不给写工具，而不是往提示词里写"请不要改文件"。
            const system = Store.agents.get(sessionId).config.system
            expect(system).toContain('attempt_completion')
            expect(system).not.toContain('请不要改文件')
        })
    })

    test('智能体名写错时按填错处理，不改动已有设置', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await expect(Session.saveSettings({ sessionId, agent: 'hacker' })).rejects.toThrow(/agent must be/i)
            // 坏输入不能把设置改坏，也不能留下半个状态。
            expect((await Session.readSettings({ sessionId })).agent).toBe('build')
        })
    })

    test('自定义智能体可以点名只给哪些工具', async () => {
        await withHome(async () => {
            const sessionId = await newSession({
                extra: { agents: { review: { label: '审查', tools: ['read_file', 'list_files'] } } },
            })
            await Session.saveSettings({ sessionId, agent: 'review' })

            // 点名之外的工具一个都不给，task 没点名也不装。
            expect(toolNames(sessionId)).toEqual(['list_files', 'read_file'])
        })
    })

    test('自定义 readOnly 智能体去掉写工具，但保留读取和子任务', async () => {
        await withHome(async () => {
            const sessionId = await newSession({
                extra: { agents: { audit: { label: '审计', readOnly: true } } },
            })
            await Session.saveSettings({ sessionId, agent: 'audit' })

            const names = toolNames(sessionId)
            expect(names).toContain('read_file')
            expect(names).toContain('new_task')
            expect(names).not.toContain('write_to_file')
            expect(names).not.toContain('execute_command')
        })
    })

    test('自定义智能体点名 task 时才装任务工具', async () => {
        await withHome(async () => {
            const sessionId = await newSession({
                extra: { agents: { solo: { label: '单干', tools: ['read_file', 'new_task'] } } },
            })
            await Session.saveSettings({ sessionId, agent: 'solo' })

            expect(toolNames(sessionId)).toEqual(['new_task', 'read_file'])
        })
    })

    test('旧自定义智能体里的工具名自动换成新名字', async () => {
        await withHome(async () => {
            const sessionId = await newSession({
                extra: { agents: { legacy: { label: '旧智能体', tools: ['file_read', 'file_list', 'task', 'finish'] } } },
            })
            await Session.saveSettings({ sessionId, agent: 'legacy' })

            expect(toolNames(sessionId)).toEqual(expect.arrayContaining([
                'read_file', 'list_files', 'new_task', 'attempt_completion',
            ]))
        })
    })

    test('自定义智能体里写错的工具名直接忽略，不会让会话打不开', async () => {
        await withHome(async () => {
            const sessionId = await newSession({
                extra: { agents: { odd: { label: '怪智能体', tools: ['read_file', 'not_a_tool'] } } },
            })
            await Session.saveSettings({ sessionId, agent: 'odd' })

            expect(toolNames(sessionId)).toEqual(['read_file'])
        })
    })

    test('设置存到会话目录里，换一个进程读回来还是同一份', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, agent: 'plan', capabilities: { image: false } })

            // 清掉内存缓存，强制从磁盘读，模拟后端重启。
            Store.settings.clear()
            const reloaded = await Session.readSettings({ sessionId })
            expect(reloaded.agent).toBe('plan')
            expect(reloaded.capabilities.image).toBe(false)
            // 没点名的那几项保持默认。
            expect(reloaded.capabilities.cache).toBe(true)
            expect(reloaded.capabilities.stream).toBe(true)
        })
    })

    test('上一版存下的设置文件里类别少几项，读回来也会补齐', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            // 上一版只有 read / write / command / mcp 四类，subtask 是这次新加的。
            await writeFile(Path.settings(sessionId), JSON.stringify({
                agent: 'build',
                autoApprove: { read: true, write: false, command: false, mcp: false },
                capabilities: { image: true, cache: true, stream: true },
            }))
            Store.settings.clear()

            const settings = await Session.readSettings({ sessionId })
            // 老设置里开着的读取保持开着，新加的那类补成关（不替用户放行）。
            expect(settings.autoApprove).toEqual({ read: true, write: false, command: false, mcp: false, subtask: false })
        })
    })

    test('plan 智能体的子任务手里也没有写工具，不能借它绕过"只看不做"', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }] })
            const { sessionId } = await Session.create({ title: '只读委托' })
            await Session.saveSettings({ sessionId, agent: 'plan' })

            /*
             * 必须看子 agent 真正拿到的那张表，不能看主 agent 的。
             * 先装 task、后筛工具表时，主 agent 的表看起来是对的（写工具确实没了），
             * 但 task 早就把未筛的表记在自己闭包里了，子任务照样能改文件——
             * plan 智能体形同虚设，而且完全不报错。
             */
            const captured = []
            const original = Agent.create
            Agent.create = options => { captured.push(options); return original(options) }
            try {
                // 跑的是 session.js 真正装上去的那个 task，不是这里另外拼一个。
                // 另外拼一个的话，传进去的就是筛过的表，等于绕开了要检查的那一步。
                const task = Store.agents.get(sessionId).tools.handlers.new_task
                await task.execute({ description: '查一下', prompt: '查一下' }, {}).catch(() => {})
            } finally {
                Agent.create = original
            }

            const subSchema = Object.keys(captured[0]?.tools?.schema || {})
            expect(subSchema.length, '子 agent 得真有工具表，否则这条检查没意义').toBeGreaterThan(0)
            expect(subSchema).not.toContain('write_to_file')
            expect(subSchema).not.toContain('edit')
            expect(subSchema).not.toContain('apply_patch')
            expect(subSchema).not.toContain('execute_command')
            // 只读工具要留着，不然子任务什么都查不了。
            expect(subSchema).toContain('read_file')
            expect(subSchema).toContain('search_files')
        })
    })

    test('子任务上带了审批回调，而且回的是同一个会话', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            /*
             * task 建子 agent 时会带上 onPermission。少了它，agent-core 直接放行，
             * 子任务里的读文件和执行命令完全不问用户，.agentignore 也拦不住，
             * 而且不报任何错——表现只是"某个密钥文件莫名其妙被读到了"。
             * 这里盯住那次 Agent.create 实际收到了什么，不靠跑一轮真模型。
             */
            const calls = []
            const original = Agent.create
            Agent.create = options => { calls.push(options); return original(options) }
            try {
                const taskTool = Delegation.build({
                    config: {},
                    tools: Store.agents.get(sessionId).tools,
                    sessionId,
                })
                // 起一次子任务：它会立刻失败（没有真模型配置），但 Agent.create 已经被调到。
                await taskTool.execute({ description: '查一下', prompt: '查一下' }, {}).catch(() => {})
            } finally {
                Agent.create = original
            }

            const callbacks = calls[0]?.callbacks
            expect(typeof callbacks?.onPermission).toBe('function')
            // 审批请求要回到主会话，否则界面上看不到"子任务想读这个文件"。
            expect(Store.settings.has(sessionId)).toBe(true)
            // 密钥文件在这条路上也读不到。
            expect(await Approval.check({ sessionId, toolCallId: 'sub-1', toolName: 'read_file', input: { path: 'D:/app/.env' } })).toBe(false)
        })
    })

    test('能力开关会真的写进交给 agent-core 的 config', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, capabilities: { image: false, cache: false, stream: false } })

            const { config } = Store.agents.get(sessionId)
            // 这三项都直接对应 agent-core 的字段名，不做二次翻译。
            expect(config.capabilities.image).toBe(false)
            expect(config.cache).toBe(false)
            expect(config.stream).toBe(false)
        })
    })
})

describe('自动批准按类别开关', () => {
    test('默认每类全关，读文件也要先问', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            // 规则是 ask；每类都没开，所以这次调用进等待队列。
            const check = await runCheck({ sessionId, toolCallId: 'call-1', toolName: 'read_file', input: { path: 'D:/app/a.js' } })
            expect(check).toEqual({ allowed: false, asked: true })
        })
    })

    test('只开读取：读文件直接过，写文件和命令照样要问', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, autoApprove: { read: true } })

            expect(await runCheck({ sessionId, toolCallId: 'r1', toolName: 'read_file', input: { path: 'D:/app/a.js' } }))
                .toEqual({ allowed: true, asked: false })
            // 这是"细颗粒度"的关键：开了读取不该顺带把写入和命令也放行。
            expect(await runCheck({ sessionId, toolCallId: 'w1', toolName: 'write_to_file', input: { path: 'D:/app/b.js', content: 'x' } }))
                .toEqual({ allowed: false, asked: true })
            expect(await runCheck({ sessionId, toolCallId: 'c1', toolName: 'execute_command', input: { command: 'rm -rf build' } }))
                .toEqual({ allowed: false, asked: true })
        })
    })

    test('只开写入：改文件的工具直接过，读取和命令照样要问', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, autoApprove: { write: true } })

            // edit 和 apply_patch 和 file_write 是同一类，开一个就都过。
            expect(await runCheck({ sessionId, toolCallId: 'w1', toolName: 'write_to_file', input: { path: 'D:/app/b.js', content: 'x' } }))
                .toEqual({ allowed: true, asked: false })
            expect(await runCheck({ sessionId, toolCallId: 'w2', toolName: 'edit', input: { file_path: 'D:/app/b.js', old_string: 'x', new_string: 'y' } }))
                .toEqual({ allowed: true, asked: false })
            expect(await runCheck({ sessionId, toolCallId: 'r1', toolName: 'read_file', input: { path: 'D:/app/a.js' } }))
                .toEqual({ allowed: false, asked: true })
            expect(await runCheck({ sessionId, toolCallId: 'c1', toolName: 'execute_command', input: { command: 'ls' } }))
                .toEqual({ allowed: false, asked: true })
        })
    })

    test('只开执行命令：命令直接过，写文件照样要问', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, autoApprove: { command: true } })

            expect(await runCheck({ sessionId, toolCallId: 'c1', toolName: 'execute_command', input: { command: 'bun test' } }))
                .toEqual({ allowed: true, asked: false })
            expect(await runCheck({ sessionId, toolCallId: 'w1', toolName: 'write_to_file', input: { path: 'D:/app/b.js', content: 'x' } }))
                .toEqual({ allowed: false, asked: true })
        })
    })

    test('只开子任务：开子任务直接过，它自己要改文件仍会问', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, autoApprove: { subtask: true } })

            expect(await runCheck({ sessionId, toolCallId: 't1', toolName: 'new_task', input: { description: '查一下', prompt: '查一下用法' } }))
                .toEqual({ allowed: true, asked: false })
            // 子任务自己拿的工具表还是照常走审批，不能借"授权开子任务"绕过写入那一关。
            expect(await runCheck({ sessionId, toolCallId: 'w1', toolName: 'write_to_file', input: { path: 'D:/app/b.js', content: 'x' } }))
                .toEqual({ allowed: false, asked: true })
        })
    })

    test('MCP 工具按服务名归类，开 MCP 只放行 MCP 工具', async () => {
        await withHome(async () => {
            const sessionId = await newSession({ extra: { mcp: { everything: { command: 'bun', args: [] } } } })
            await Session.saveSettings({ sessionId, autoApprove: { mcp: true } })

            // 配置里有 everything 这个服务，带这个前缀的工具就归 MCP 那一类。
            expect(await runCheck({ sessionId, toolCallId: 'm1', toolName: 'everything_echo', input: { message: 'hi' } }))
                .toEqual({ allowed: true, asked: false })
            expect(await runCheck({ sessionId, toolCallId: 'r1', toolName: 'read_file', input: { path: 'D:/app/a.js' } }))
                .toEqual({ allowed: false, asked: true })
        })
    })

    test('名字撞上服务名前缀、但配置里没有这个服务时，不算 MCP，照样要问', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, autoApprove: { mcp: true } })

            // 用户自己写了一个叫 everything_echo 的工具，它不是 MCP 服务给的。
            // 光看名字认不出，所以要拿配置里的服务名比一次，比不中就按未分类处理。
            expect(await runCheck({ sessionId, toolCallId: 'u1', toolName: 'everything_echo', input: {} }))
                .toEqual({ allowed: false, asked: true })
        })
    })

    test('认不出类别的工具一律要问，每类全开也一样', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, autoApprove: allOn() })

            // 用户自己放进去的工具没人给它分类，不能因为"不知道它是什么"就替用户放行。
            expect(await runCheck({ sessionId, toolCallId: 'u1', toolName: '我写的脚本', input: { run: true } }))
                .toEqual({ allowed: false, asked: true })
        })
    })

    test('记清单和结束循环本来就不问，不设开关', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            // 每类都关着，一件不改文件的小事也不该弹窗——不然用户只会一直点同意。
            expect(await runCheck({ sessionId, toolCallId: 'd1', toolName: 'update_todo_list', input: { todos: '' } }))
                .toEqual({ allowed: true, asked: false })
            expect(await runCheck({ sessionId, toolCallId: 'd2', toolName: 'attempt_completion', input: { result: '好了' } }))
                .toEqual({ allowed: true, asked: false })
            // 它们也不该出现在自动批准的设置里，没有开关可点。
            expect(Settings.KINDS.map(item => item.kind)).not.toContain('never')
        })
    })

    test('随时可以一类一类地改，改一类不动别类', async () => {
        await withHome(async () => {
            const sessionId = await newSession()

            // 先只开读取。
            let settings = await Session.saveSettings({ sessionId, autoApprove: { read: true } })
            expect(settings.autoApprove).toEqual({ ...allOff(), read: true })

            // 再加开执行命令：读取那一位不能被动到。
            settings = await Session.saveSettings({ sessionId, autoApprove: { command: true } })
            expect(settings.autoApprove).toEqual({ ...allOff(), read: true, command: true })

            // 关掉读取：命令和其余几位照旧。
            settings = await Session.saveSettings({ sessionId, autoApprove: { read: false } })
            expect(settings.autoApprove).toEqual({ ...allOff(), command: true })
            expect(await runCheck({ sessionId, toolCallId: 'r1', toolName: 'read_file', input: { path: 'D:/app/a.js' } }))
                .toEqual({ allowed: false, asked: true })
            expect(await runCheck({ sessionId, toolCallId: 'c1', toolName: 'execute_command', input: { command: 'ls' } }))
                .toEqual({ allowed: true, asked: false })
        })
    })

    test('界面传了认不出的类别名时不存进去，只认清单里那几类', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const settings = await Session.saveSettings({ sessionId, autoApprove: { read: true, 乱写: true } })
            expect(settings.autoApprove).toEqual({ ...allOff(), read: true })
        })
    })

    test('老版本设置文件里的那个总开关还能读，摊到每一类上', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            // 更早的一版只有一个 autoApprove 布尔。用户升级后不该发现自己的设置丢了。
            await writeFile(Path.settings(sessionId), JSON.stringify({
                agent: 'build',
                autoApprove: true,
                capabilities: { image: true, cache: true, stream: true },
            }))
            Store.settings.clear()

            const settings = await Session.readSettings({ sessionId })
            expect(settings.autoApprove).toEqual(allOn())
        })
    })

    test('任务跑着的时候也能改自动批准，当场生效', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            // 模拟"模型正在干活"：只把 running 标上，不真的起一轮请求。
            Store.agents.get(sessionId).running = true

            // 看到模型在乱改文件时，用户要能当场把"写入"关掉，而不是先停下来再改。
            // 自动批准是审批时现读设置的，不用重建 Agent，所以不受 running 限制。
            const settings = await Session.saveSettings({ sessionId, autoApprove: { write: false } })
            expect(settings.autoApprove.write).toBe(false)
            expect(await runCheck({ sessionId, toolCallId: 'w1', toolName: 'write_to_file', input: { path: 'D:/app/b.js', content: 'x' } }))
                .toEqual({ allowed: false, asked: true })

            // 反过来也能开：任务跑着的时候把读取放开。
            const opened = await Session.saveSettings({ sessionId, autoApprove: { read: true } })
            expect(opened.autoApprove.read).toBe(true)
            expect(await runCheck({ sessionId, toolCallId: 'r1', toolName: 'read_file', input: { path: 'D:/app/a.js' } }))
                .toEqual({ allowed: true, asked: false })
        })
    })

    test('任务跑着的时候不许换智能体，否则工具表会在半路被换掉', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            Store.agents.get(sessionId).running = true
            await expect(Session.saveSettings({ sessionId, agent: 'plan' })).rejects.toThrow(/already running/i)
            // 被拒的改动不该留在磁盘上。
            expect((await Settings.read({ sessionId })).agent).toBe('build')
        })
    })

    test('自动批准不能绕过忽略规则', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, autoApprove: { read: true } })
            // 自动批准省掉的是"问一遍"，不是把 .agentignore 也一起关掉。
            const check = await runCheck({ sessionId, toolCallId: 'call-3', toolName: 'read_file', input: { path: 'D:/app/.env' } })
            expect(check).toEqual({ allowed: false, asked: false })
        })
    })
})

describe('哪件事用哪个模型', () => {
    test('不点名就和主模型共用，不给用户增加负担', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            // uses 是空的，压缩、标题、子任务全都跟主模型走。
            expect((await Session.readSettings({ sessionId })).uses).toEqual({})
        })
    })

    test('给压缩单独配一个模型时，真的写进 agent-core 的 config.compact', async () => {
        await withHome(async () => {
            await Config.set({
                providers: [
                    { name: 'local', models: ['主模型'] },
                    { name: 'cheap', models: ['小模型'] },
                ],
                permission: { '*': 'ask' },
            })
            const { sessionId } = await Session.create({ title: '分开配模型' })
            await Session.saveSettings({ sessionId, uses: { compact: { provider: 'cheap', model: '小模型' } } })

            const { config } = Store.agents.get(sessionId)
            // agent-core 自带 config.compact，我们只是把它接出来，不另造一套。
            expect(config.compact).toBeDefined()
            expect(config.compact.model).toBe('小模型')
            // 压缩只换连接，不换主模型的 system 和上下文预算：
            // 压缩请求有多大由主模型的预算决定，跟压缩模型自己的窗口无关。
            expect(config.compact.system).toBeUndefined()
            expect(config.compact.maxContextTokens).toBeUndefined()
            expect(config.model).toBe('主模型')
        })
    })

    test('三件事可以各配各的，互不影响', async () => {
        await withHome(async () => {
            await Config.set({
                providers: [{ name: 'local', models: ['主模型', '小模型', '标题模型'] }],
                permission: { '*': 'ask' },
            })
            const { sessionId } = await Session.create({ title: '三件都配' })
            const settings = await Session.saveSettings({
                sessionId,
                uses: {
                    compact: { provider: 'local', model: '小模型' },
                    title: { provider: 'local', model: '标题模型' },
                    subtask: { provider: 'local', model: '主模型' },
                },
            })
            expect(settings.uses).toEqual({
                compact: { provider: 'local', model: '小模型' },
                title: { provider: 'local', model: '标题模型' },
                subtask: { provider: 'local', model: '主模型' },
            })
        })
    })

    test('清空某一项表示改回和主模型共用，不会留下半条记录', async () => {
        await withHome(async () => {
            await Config.set({
                providers: [
                    { name: 'local', models: ['主模型'] },
                    { name: 'cheap', models: ['小模型'] },
                ],
                permission: { '*': 'ask' },
            })
            const { sessionId } = await Session.create({ title: '改回共用' })
            await Session.saveSettings({ sessionId, uses: { compact: { provider: 'cheap', model: '小模型' } } })

            // 用户把这一项清掉（传 null），要真的回到"共用"。
            const settings = await Session.saveSettings({ sessionId, uses: { compact: null } })
            expect(settings.uses).toEqual({})
        })
    })

    test('只填了供应商没填模型时不算配过，免得发出一个没有模型的请求', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const settings = await Session.saveSettings({ sessionId, uses: { compact: { provider: 'local' } } })
            // 缺一半配置就按"没配"处理，不能存成 { provider: 'local' } 让后面去猜模型。
            expect(settings.uses).toEqual({})
        })
    })

    test('界面上没这个用途时不认，只认清单里那三件', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const settings = await Session.saveSettings({
                sessionId,
                uses: { 乱写: { provider: 'local', model: 'x' } },
            })
            expect(settings.uses).toEqual({})
        })
    })
})

describe('自动批准的刹车', () => {
    test('默认给一个宽松但有数的档，不是完全不管', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const { autoApproveLimit } = await Session.readSettings({ sessionId })
            // 开了自动批准又不设上限，同一件小事做五十遍都没人管，所以默认给个数。
            expect(autoApproveLimit).toBe(50)
        })
    })

    test('0 表示不设上限，用户想彻底放开就设 0', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const settings = await Session.saveSettings({ sessionId, autoApproveLimit: 0 })
            expect(settings.autoApproveLimit).toBe(0)
        })
    })

    test('连续放行到上限就停下来问一次', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, autoApprove: { read: true }, autoApproveLimit: 3 })

            // 前三笔按自动批准直接过。
            for (const index of [1, 2, 3]) {
                expect(await runCheck({ sessionId, toolCallId: `r${index}`, toolName: 'read_file', input: { path: `D:/app/${index}.js` } }))
                    .toEqual({ allowed: true, asked: false })
            }
            // 第四笔要被刹住：模型跑偏的典型表现是"同一件小事做了很多遍"。
            expect(await runCheck({ sessionId, toolCallId: 'r4', toolName: 'read_file', input: { path: 'D:/app/4.js' } }))
                .toEqual({ allowed: false, asked: true })
        })
    })

    test('答过一次就重新计数，自动批准不会永久失灵', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, autoApprove: { read: true }, autoApproveLimit: 2 })

            await runCheck({ sessionId, toolCallId: 'r1', toolName: 'read_file', input: { path: 'D:/app/1.js' } })
            await runCheck({ sessionId, toolCallId: 'r2', toolName: 'read_file', input: { path: 'D:/app/2.js' } })
            // 第三笔被刹住，用户答了一次"继续"。
            const blocked = Approval.check({ sessionId, toolCallId: 'r3', toolName: 'read_file', input: { path: 'D:/app/3.js' } })
            await Bun.sleep(0)
            expect(Store.approvals.has(`${sessionId}:r3`)).toBe(true)
            await Approval.decide({ sessionId, toolCallId: 'r3', decision: 'allow-once' })
            expect(await blocked).toBe(true)

            // 计数归零，接下来又能自动放行两笔——不然一到顶就再也回不去。
            expect(await runCheck({ sessionId, toolCallId: 'r4', toolName: 'read_file', input: { path: 'D:/app/4.js' } }))
                .toEqual({ allowed: true, asked: false })
        })
    })

    test('上限设 0 时不刹，一路自动放行', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, autoApprove: { read: true }, autoApproveLimit: 0 })

            for (const index of [1, 2, 3, 4, 5]) {
                expect(await runCheck({ sessionId, toolCallId: `r${index}`, toolName: 'read_file', input: { path: `D:/app/${index}.js` } }))
                    .toEqual({ allowed: true, asked: false })
            }
        })
    })

    test('自动压缩阈值可改，写错时保持原值', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, compactThreshold: 0.6 })
            expect((await Session.readSettings({ sessionId })).compactThreshold).toBe(0.6)
            expect(Store.agents.get(sessionId).config.compactThreshold).toBe(0.6)

            // 1.5 超出范围，不能写进去；保留刚才的 0.6。
            await Session.saveSettings({ sessionId, compactThreshold: 1.5 })
            expect((await Session.readSettings({ sessionId })).compactThreshold).toBe(0.6)
        })
    })

    test('填了负数、小数或不是数字时保持原样，不把上限设成没意义的值', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, autoApproveLimit: 10 })
            const settings = await Session.saveSettings({ sessionId, autoApproveLimit: -5 })
            // 认不出来的值保持上一次的 10。
            expect(settings.autoApproveLimit).toBe(10)
            const fractional = await Session.saveSettings({ sessionId, autoApproveLimit: 2.5 })
            expect(fractional.autoApproveLimit).toBe(10)
        })
    })
})

describe('自动生成标题', () => {
    test('默认开着，用户可以在设置里关掉', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            expect((await Session.readSettings({ sessionId })).autoTitle).toBe(true)
            expect((await Session.saveSettings({ sessionId, autoTitle: false })).autoTitle).toBe(false)
        })
    })

    test('模型回的东西被收拾成能直接当标题的样子', async () => {
        // 模型不会老老实实只回标题，常见包装都要去掉，不然侧边栏会显示「"标题："修复登录"」这种。
        expect(Title.clean('"修复登录跳转"')).toBe('修复登录跳转')
        expect(Title.clean('标题：修复登录跳转')).toBe('修复登录跳转')
        expect(Title.clean('修复登录跳转。')).toBe('修复登录跳转')
        expect(Title.clean('修复登录跳转\n这句是解释，不该进来')).toBe('修复登录跳转')
        expect(Title.clean('《修复登录跳转》')).toBe('修复登录跳转')
        // 太长的硬截，总不能把一整段话塞进侧边栏。
        expect(Title.clean('一'.repeat(80)).length).toBe(Title.MAX_LENGTH)
        // 什么都收拾不出来时返回空串，调用方据此保持"新对话"。
        expect(Title.clean('')).toBe('')
    })

    test('模型连不上时返回 null，不把这一轮弄挂', async () => {
        await withHome(async () => {
            // 指向一个不存在的地址，起标题会失败。
            const title = await Title.generate({
                connection: { baseURL: 'http://127.0.0.1:1/v1', model: 'x', protocol: 'chat' },
                messages: [{ role: 'user', content: '帮我看看这个文件为什么读不了' }],
            })
            // 起标题失败不该影响用户干活，只是没有标题。
            expect(title).toBeNull()
        })
    })

    test('一条消息都没有时不起标题，省一次请求', async () => {
        await withHome(async () => {
            const title = await Title.generate({ connection: {}, messages: [] })
            expect(title).toBeNull()
        })
    })
})

describe('会话模型切换', () => {
    test('改供应商和模型后，元信息和 Agent 的 config 都跟着换', async () => {
        await withHome(async () => {
            await Config.set({
                providers: [
                    { name: 'local', models: ['first', 'second'] },
                    { name: 'other', models: ['third'] },
                ],
                rules: { enabled: false },
            })
            const { sessionId } = await Session.create({ title: 'Switch model' })

            const meta = await Session.setModel({ sessionId, provider: 'other', model: 'third' })
            expect(meta.provider).toBe('other')
            expect(meta.model).toBe('third')
            expect((await Session.read({ sessionId })).model).toBe('third')
            // 压缩等功能用 Agent 自己的 config，必须跟着换。
            expect(Store.agents.get(sessionId).config.model).toBe('third')
        })
    })

    test('供应商不存在时按填错处理，不改动原模型', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await expect(Session.setModel({ sessionId, provider: 'missing', model: 'x' })).rejects.toMatchObject({ status: 400 })
            expect((await Session.read({ sessionId })).model).toBe('model')
        })
    })

    test('任务运行中不能切换模型', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            Store.agents.get(sessionId).running = true
            await expect(Session.setModel({ sessionId, provider: 'local', model: 'other' })).rejects.toMatchObject({ status: 409 })
            Store.agents.get(sessionId).running = false
        })
    })

    test('HTTP 接口能切换模型', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const response = await app.handle(new Request(`http://localhost/session/model/${sessionId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ provider: 'local', model: 'other' }),
            }))
            expect(response.status).toBe(200)
            expect((await response.json()).model).toBe('other')
        })
    })
})

describe('会话分支', () => {
    test('分支复制历史和运行设置', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await History.add({ sessionId, message: Agent.history.user({ content: '第一句' }) })
            await History.add({ sessionId, message: Agent.history.assistant({ content: '第二句' }) })
            await History.save({ sessionId })
            await Session.saveSettings({ sessionId, agent: 'plan' })

            const { sessionId: branchId } = await Session.fork({ sessionId })
            expect(branchId).not.toBe(sessionId)

            const branch = await Session.read({ sessionId: branchId })
            expect(branch.title).toBe('设置测试（分支）')
            expect(branch.history).toHaveLength(2)
            expect(branch.settings.agent).toBe('plan')
        })
    })

    test('可以只分支到某条消息', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const first = await History.add({ sessionId, message: Agent.history.user({ content: '只留这一句' }) })
            await History.add({ sessionId, message: Agent.history.assistant({ content: '后面这句不要' }) })
            await History.save({ sessionId })

            const { sessionId: branchId } = await Session.fork({ sessionId, messageId: first.messageId })
            const branch = await Session.read({ sessionId: branchId })
            expect(branch.history).toHaveLength(1)
            expect(branch.history[0].content).toBe('只留这一句')
        })
    })

    test('消息不存在时按填错处理', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await expect(Session.fork({ sessionId, messageId: 'missing' })).rejects.toMatchObject({ status: 404 })
        })
    })

    test('HTTP 接口能创建分支', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const response = await app.handle(new Request(`http://localhost/session/fork/${sessionId}`, { method: 'POST' }))
            expect(response.status).toBe(200)
            const { sessionId: branchId } = await response.json()
            expect(branchId).not.toBe(sessionId)
        })
    })
})

describe('设置接口', () => {
    test('读设置和改设置都能通过 HTTP 走通', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const request = (path, options) => app.handle(new Request(`http://localhost${path}`, options))

            const initial = await request(`/session/settings/${sessionId}`)
            expect(initial.status).toBe(200)
            expect((await initial.json()).agent).toBe('build')

            const saved = await request(`/session/settings/${sessionId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ agent: 'plan' }),
            })
            expect(saved.status).toBe(200)
            expect((await saved.json()).agent).toBe('plan')

            // 智能体名写错时返回 400 而不是 500——这是用户填错。
            const bad = await request(`/session/settings/${sessionId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ agent: 'nope' }),
            })
            expect(bad.status).toBe(400)
        })
    })

    test('界面上点一个类别的开关就走一个 PATCH', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const response = await app.handle(new Request(`http://localhost/session/settings/${sessionId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ autoApprove: { read: true } }),
            }))
            expect(response.status).toBe(200)
            expect((await response.json()).autoApprove).toEqual({ ...allOff(), read: true })
        })
    })

    test('读取会话时会带上当前设置，界面不用再单独问一次', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, agent: 'plan', autoApprove: { read: true } })
            const session = await Session.read({ sessionId })
            expect(session.settings).toMatchObject({
                agent: 'plan',
                autoApprove: { ...allOff(), read: true },
            })
        })
    })
})
