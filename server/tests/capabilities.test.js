/*
 * 能力管理测试：本机 MCP 识别与导入、服务增删改查，以及技能的识别、启用和增改删。
 *
 * 识别读取的是临时 HOME，不会碰真实电脑上的配置；每个测试一份数据目录。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import Path from '../utils/path.js'
import Agent from '../features/agent.js'
import Config from '../features/config.js'
import Discover from '../features/discover.js'
import History from '../features/history.js'
import Mcp from '../features/mcp.js'
import SkillFeature from '../features/skills.js'
import Session from '../commands/session.js'
import Assemble from '../commands/assemble.js'
import Skill from '../tools/skill.js'
import store from '../store.js'
import { app } from '../server.js'

// 管理面现在只有一条 POST /admin，测试里保留按旧名字调用的写法：
// 这里把 "方法 + 路径 + query/body" 翻成 { op, ...参数 }，断言一行不用改。
const OP_OF = {
    'GET /mcp/list': 'mcp.list',
    'POST /mcp/save': 'mcp.save',
    'POST /mcp/import': 'mcp.import',
    'POST /mcp/remove': 'mcp.remove',
    'PATCH /mcp/toggle': 'mcp.toggle',
    'POST /mcp/test': 'mcp.test',
    'GET /skill/list': 'skill.list',
    'GET /skill/read': 'skill.read',
    'POST /skill/save': 'skill.save',
    'POST /skill/remove': 'skill.remove',
    'PATCH /skill/toggle': 'skill.toggle',
    'PATCH /skill/source': 'skill.source',
}

const request = (path, options = {}) => {
    const [pathname, search] = String(path).split('?')
    const method = (options.method || 'GET').toUpperCase()
    const op = OP_OF[`${method} ${pathname}`]
    if (!op) return app.handle(new Request(`http://localhost${path}`, options))
    const query = Object.fromEntries(new URLSearchParams(search || ''))
    const body = options.body ? JSON.parse(options.body) : {}
    return app.handle(new Request('http://localhost/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op, ...query, ...body }),
    }))
}
const json = (path, method, body) => request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
})

const withHome = async callback => {
    const root = join(tmpdir(), `agent-capabilities-${crypto.randomUUID()}`)
    const data = join(root, 'data')
    const discovery = join(root, 'home')
    const project = join(root, 'project')
    const previous = {
        home: process.env.AGENT_HOME,
        discovery: process.env.AGENT_DISCOVERY_HOME,
        xdg: process.env.XDG_CONFIG_HOME,
        appdata: process.env.APPDATA,
    }
    process.env.AGENT_HOME = data
    Path.lock(data)
    process.env.AGENT_DISCOVERY_HOME = discovery
    process.env.XDG_CONFIG_HOME = join(discovery, '.config')
    process.env.APPDATA = join(discovery, 'AppData', 'Roaming')
    await mkdir(data, { recursive: true })
    await mkdir(project, { recursive: true })
    Object.keys(store.config).forEach(key => delete store.config[key])
    Agent.runtime().clear()
    History.clear()

    try {
        return await callback({ root, data, discovery, home: discovery, project })
    } finally {
        Path.unlock()
        for (const [key, value] of [['AGENT_HOME', previous.home], ['AGENT_DISCOVERY_HOME', previous.discovery], ['XDG_CONFIG_HOME', previous.xdg], ['APPDATA', previous.appdata]]) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
        await rm(root, { recursive: true, force: true })
    }
}

const writeSkill = async (directory, name, description, body) => {
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`)
}

const writeJson = async (path, value) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(value, null, 2))
}

// 在本机模拟几套别的软件留下的配置。
const writeDiscovery = async ({ home, project }) => {
    await writeJson(join(home, '.cursor', 'mcp.json'), {
        mcpServers: {
            github: { command: 'npx', args: ['-y', 'server-github'], env: { GITHUB_TOKEN: 'secret' } },
            remote: { url: 'https://mcp.example.test/mcp', type: 'http', headers: { Authorization: 'Bearer token' } },
        },
    })
    await writeJson(join(home, '.claude.json'), {
        mcpServers: { shared: { command: 'bunx', args: ['shared-server'] } },
        projects: {
            [project]: { mcpServers: { 'project-only': { command: 'bunx', args: ['project-server'] } } },
        },
    })
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(join(home, '.codex', 'config.toml'), [
        '[mcp_servers.context7]',
        'command = "npx"',
        'args = ["-y", "@upstash/context7-mcp"]',
        '',
        '[mcp_servers.context7.env]',
        'API_KEY = "abc"',
    ].join('\n'))
}

describe('本机 MCP 识别', () => {
    test('识别 macOS Application Support 中的 MCP 并通过接口导入', async () => {
        await withHome(async ({ home, project }) => {
            const base = join(home, 'Library', 'Application Support')
            const fixtures = [
                ['claude-desktop-mac', join(base, 'Claude', 'claude_desktop_config.json'), 'mcpServers'],
                ['vscode-mac', join(base, 'Code', 'User', 'mcp.json'), 'servers'],
                ['cline-mac', join(base, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'), 'mcpServers'],
                ['roo-mac', join(base, 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json'), 'mcpServers'],
            ]
            for (const [id, path, key] of fixtures) {
                await writeJson(path, { [key]: { [id]: { command: 'bun', args: ['mcp.js'] } } })
            }
            const response = await request(`/mcp/list?cwd=${encodeURIComponent(project)}`)
            expect(response.status).toBe(200)
            const { detected } = await response.json()
            expect(detected.servers.map(item => item.source).sort()).toEqual(fixtures.map(item => item[0]).sort())
            const imported = await json('/mcp/import', 'POST', { ids: detected.servers.map(item => item.id), cwd: project })
            expect(imported.status).toBe(200)
            expect((await imported.json()).imported.sort()).toEqual(fixtures.map(item => item[0]).sort())
        })
    })

    test('扫出常见客户端的服务，并把值遮掉', async () => {
        await withHome(async ({ home, project }) => {
            await writeDiscovery({ home, project })
            const result = await Discover.mcp({ cwd: project })

            const names = result.servers.map(item => item.name).sort()
            expect(names).toEqual(['context7', 'github', 'project-only', 'remote', 'shared'])

            const github = result.servers.find(item => item.name === 'github')
            expect(github.definition.command).toBe('npx')
            expect(github.definition.args).toEqual(['-y', 'server-github'])
            expect(github.definition.env).toEqual({})                 // 值不回传
            expect(github.envKeys).toEqual(['GITHUB_TOKEN'])

            const remote = result.servers.find(item => item.name === 'remote')
            expect(remote.definition.transport).toBe('http')
            expect(remote.definition.url).toBe('https://mcp.example.test/mcp')
            expect(remote.definition.headers).toEqual({})
            expect(remote.headerKeys).toEqual(['Authorization'])

            const codex = result.servers.find(item => item.name === 'context7')
            expect(codex.app).toBe('Codex')
            expect(codex.definition.args).toEqual(['-y', '@upstash/context7-mcp'])
            expect(codex.envKeys).toEqual(['API_KEY'])

            expect(result.sources.map(item => item.id)).toContain('cursor')
            expect(result.sources.find(item => item.id === 'cursor').servers).toBe(2)
        })
    })

    test('Codex 的 TOML 用完整解析器：多行数组、转义、多行字符串都认得', async () => {
        // 以前手写的解析器只认双引号、单层数组和 true/false，
        // 下面这几种写法会静默读不到，用户改一下格式就丢服务。
        await withHome(async ({ home, project }) => {
            await mkdir(join(home, '.codex'), { recursive: true })
            await writeFile(join(home, '.codex', 'config.toml'), [
                '[mcp_servers.multiline_args]',
                'command = "npx"',
                'args = [',
                '  "-y",',
                '  "@scope/server",',
                ']',
                '',
                '[mcp_servers.single_quoted]',
                "command = 'python'",
                'args = ["-m", "server"]',
                '',
                '[mcp_servers.escaped]',
                'command = "bun"',
                'args = ["\\u4e2d\\u6587"]',
            ].join('\n'))

            const result = await Discover.mcp({ cwd: project, home, redact: false })
            const byName = Object.fromEntries(result.servers.map(item => [item.name, item]))

            expect(byName.multiline_args.definition.args).toEqual(['-y', '@scope/server'])
            expect(byName.single_quoted.definition.command).toBe('python')
            // \u 转义要真的解出来，而不是原样留下反斜杠
            expect(byName.escaped.definition.args).toEqual(['中文'])
        })
    })

    test('Codex 配置坏了不影响其他来源的识别', async () => {
        await withHome(async ({ home, project }) => {
            await mkdir(join(home, '.codex'), { recursive: true })
            await writeFile(join(home, '.codex', 'config.toml'), 'this is not valid toml [[')
            await mkdir(join(home, '.cursor'), { recursive: true })
            await writeFile(join(home, '.cursor', 'mcp.json'), JSON.stringify({
                mcpServers: { cursor_server: { command: 'bunx', args: ['x'] } },
            }))

            const result = await Discover.mcp({ cwd: project, home })
            // 坏文件按空处理，不抛错，别的来源照常
            expect(result.servers.some(item => item.name === 'cursor_server')).toBe(true)
        })
    })

    test('导入时按编号重新读源文件，环境变量完整写进自己的配置', async () => {
        await withHome(async ({ home, project }) => {
            await writeDiscovery({ home, project })
            const { detected } = await (await request(`/mcp/list?cwd=${encodeURIComponent(project)}`)).json()
            const id = detected.servers.find(item => item.name === 'github').id

            const imported = await (await json('/mcp/import', 'POST', { ids: [id], cwd: project })).json()
            expect(imported.imported).toEqual(['github'])
            expect(imported.skipped).toEqual([])

            const saved = await (await request('/mcp/list')).json()
            expect(saved.servers.find(item => item.name === 'github').definition.env).toEqual({ GITHUB_TOKEN: 'secret' })

            const onDisk = JSON.parse(await readFile(join(process.env.AGENT_HOME, 'config.json'), 'utf8'))
            expect(onDisk.mcp.github.env.GITHUB_TOKEN).toBe('secret')
        })
    })

    test('重复导入和不存在编号都只跳过，不报错', async () => {
        await withHome(async ({ home, project }) => {
            await writeDiscovery({ home, project })
            const { detected } = await (await request(`/mcp/list?cwd=${encodeURIComponent(project)}`)).json()
            const id = detected.servers.find(item => item.name === 'github').id
            await json('/mcp/import', 'POST', { ids: [id], cwd: project })

            const again = await (await json('/mcp/import', 'POST', { ids: [id, 'cursor::missing'], cwd: project })).json()
            expect(again.imported).toEqual([])
            expect(again.skipped).toEqual([
                { id, name: 'github', reason: 'exists' },
                { id: 'cursor::missing', reason: 'missing' },
            ])
        })
    })

    test('编号列表填错时按 400 返回', async () => {
        await withHome(async () => {
            expect((await json('/mcp/import', 'POST', {})).status).toBe(400)
            expect((await json('/mcp/import', 'POST', { ids: [] })).status).toBe(400)
            expect((await json('/mcp/import', 'POST', { ids: [123] })).status).toBe(400)
        })
    })
})

describe('MCP 服务管理', () => {
    test('新增、改名替换、启停和删除都写回配置', async () => {
        await withHome(async () => {
            const saved = await (await json('/mcp/save', 'POST', {
                name: 'everything',
                definition: { command: 'bun', args: ['server.js'], env: { KEY: 'value' } },
            })).json()
            expect(saved.name).toBe('everything')
            expect(saved.enabled).toBe(true)

            expect((await (await request('/mcp/list')).json()).servers.map(item => item.name)).toEqual(['everything'])
            expect((await (await json('/mcp/toggle', 'PATCH', { name: 'everything', enabled: false })).json()).enabled).toBe(false)
            expect((await (await request('/mcp/list')).json()).servers[0].enabled).toBe(false)

            const updated = await (await json('/mcp/save', 'POST', {
                name: 'everything',
                definition: { transport: 'sse', url: 'https://example.test/sse' },
            })).json()
            expect(updated.definition.transport).toBe('sse')

            expect(await (await json('/mcp/remove', 'POST', { name: 'everything' })).json()).toEqual({ ok: true, name: 'everything' })
            expect((await (await request('/mcp/list')).json()).servers).toEqual([])

            const onDisk = JSON.parse(await readFile(join(process.env.AGENT_HOME, 'config.json'), 'utf8'))
            expect(onDisk.mcp).toEqual({})
        })
    })

    test('缺名称、缺命令、缺地址和未知服务都按 400 / 404 返回', async () => {
        await withHome(async () => {
            expect((await json('/mcp/save', 'POST', { definition: { command: 'bun' } })).status).toBe(400)
            expect((await json('/mcp/save', 'POST', { name: 'x', definition: { transport: 'stdio' } })).status).toBe(400)
            expect((await json('/mcp/save', 'POST', { name: 'x', definition: { transport: 'http' } })).status).toBe(400)
            expect((await json('/mcp/toggle', 'PATCH', { name: 'missing', enabled: true })).status).toBe(404)
            expect((await json('/mcp/remove', 'POST', { name: 'missing' })).status).toBe(404)
            expect((await json('/mcp/test', 'POST', { name: 'missing' })).status).toBe(404)
            expect((await json('/mcp/toggle', 'PATCH', { name: 'x', enabled: 'yes' })).status).toBe(400)
        })
    })

    test('连接测试返回工具名；起不来时返回失败原因而不是 500', async () => {
        await withHome(async () => {
            await json('/mcp/save', 'POST', {
                name: 'broken',
                definition: { command: 'definitely-not-a-real-command-in-this-test' },
            })
            const failed = await (await json('/mcp/test', 'POST', { name: 'broken' })).json()
            expect(failed.ok).toBe(false)
            expect(failed.tools).toEqual([])
            expect(typeof failed.error).toBe('string')
        })
    })

    test('启动失败的 MCP 服务本次进程内跳过，并报出原因，但不改用户配置', async () => {
        await withHome(async () => {
            await json('/mcp/save', 'POST', {
                name: 'broken_server',
                definition: { command: 'definitely-not-a-real-command-in-this-test' },
            })
            // 触发一次工具装配拉取：坏服务不能把会话装配拖垮
            const tools = await Mcp.tools()
            expect(Object.keys(tools).some(k => k.startsWith('broken_server_'))).toBe(false)

            // 设置页能看到它起不来，并带原因
            const listed = (await (await request('/mcp/list')).json()).servers.find(item => item.name === 'broken_server')
            expect(listed.enabled).toBe(true)                       // 用户没有关它，就不替用户关
            expect(listed.error).toBeTruthy()                        // 起不来的原因具体写什么不重要，但必须有

            // 配置一个字段都没被改：磁盘上和内存里都还是用户写的那份
            expect(store.config.mcp.broken_server.enabled).toBe(true)
            const onDisk = JSON.parse(await readFile(join(process.env.AGENT_HOME, 'config.json'), 'utf8'))
            expect(onDisk.mcp.broken_server.enabled).toBe(true)

            // 同一进程内不再重复重试，否则每轮对话都要白等几秒
            const started = Date.now()
            await Mcp.tools()
            expect(Date.now() - started).toBeLessThan(1000)
        })
    })
})

describe('技能识别与管理', () => {
    test('自己的技能直接生效，别的软件的目录先识别、启用后才生效', async () => {
        await withHome(async ({ root, discovery, project }) => {
            await writeSkill(join(process.env.AGENT_HOME, 'skills', 'review'), 'review', '审查改动', '第一步')
            await writeSkill(join(project, '.agent', 'skills', 'deploy'), 'deploy', '部署', '部署正文')
            const external = join(discovery, '.claude', 'skills')
            await writeSkill(join(external, 'lint'), 'lint', '检查代码', '运行 lint')

            const before = await (await request(`/skill/list?cwd=${encodeURIComponent(project)}`)).json()
            expect(before.skills.map(item => item.name).sort()).toEqual(['deploy', 'review'])
            expect(before.skills.find(item => item.name === 'review').body).toBe('')   // 列表不带正文
            const claudeRoot = before.roots.find(item => item.id === 'claude')
            expect(claudeRoot).toMatchObject({ exists: true, enabled: false, skillCount: 1 })

            const enabled = await (await json('/skill/source', 'PATCH', { path: external, enabled: true })).json()
            expect(enabled).toEqual({ path: external, enabled: true })

            const after = await (await request(`/skill/list?cwd=${encodeURIComponent(project)}`)).json()
            expect(after.skills.map(item => item.name).sort()).toEqual(['deploy', 'lint', 'review'])
            expect(after.skills.find(item => item.name === 'lint').app).toBe('Claude Code')

            await json('/skill/source', 'PATCH', { path: external, enabled: false })
            expect((await (await request(`/skill/list?cwd=${encodeURIComponent(project)}`)).json()).skills.some(item => item.name === 'lint')).toBe(false)
            expect(root).toBeTruthy()
        })
    })

    test('新建、读取、改写和删除自己的技能', async () => {
        await withHome(async ({ project }) => {
            const created = await (await json('/skill/save', 'POST', {
                name: 'write-docs',
                description: '写文档时用',
                body: '先读现有文档',
            })).json()
            expect(created.name).toBe('write-docs')
            expect(created.editable).toBe(true)

            const file = join(process.env.AGENT_HOME, 'skills', 'write-docs', 'SKILL.md')
            expect(await readFile(file, 'utf8')).toContain('先读现有文档')

            const read = await (await request(`/skill/read?name=write-docs`)).json()
            expect(read.body).toBe('先读现有文档')

            const updated = await (await json('/skill/save', 'POST', {
                name: 'write-docs',
                description: '写文档时用',
                body: '改写后的正文',
            })).json()
            expect(updated.directory).toBe(created.directory)
            expect((await (await request(`/skill/read?name=write-docs`)).json()).body).toBe('改写后的正文')

            expect((await request(`/skill/read?name=write-docs&cwd=${encodeURIComponent(project)}`)).status).toBe(200)

            const removed = await (await json('/skill/remove', 'POST', { name: 'write-docs' })).json()
            expect(removed).toEqual({ ok: true, name: 'write-docs' })
            expect((await request('/skill/read?name=write-docs')).status).toBe(404)
        })
    })

    test('项目技能写进当前目录，目录不存在时按 400 返回', async () => {
        await withHome(async ({ project }) => {
            const saved = await (await json('/skill/save', 'POST', {
                name: 'project-rule',
                description: '项目约定',
                body: '正文',
                scope: 'project',
                cwd: project,
            })).json()
            expect(saved.scope).toBe('project')
            expect(await readFile(join(project, '.agent', 'skills', 'project-rule', 'SKILL.md'), 'utf8')).toContain('正文')

            expect((await json('/skill/save', 'POST', {
                name: 'x', description: 'x', scope: 'project', cwd: join(project, 'missing'),
            })).status).toBe(400)
        })
    })

    test('填错的名称、说明和目录都按 400 返回，不写出半份文件', async () => {
        await withHome(async ({ discovery }) => {
            expect((await json('/skill/save', 'POST', { name: '../escape', description: 'x' })).status).toBe(400)
            expect((await json('/skill/save', 'POST', { name: 'ok', description: '' })).status).toBe(400)
            expect((await json('/skill/save', 'POST', { name: 'ok', description: 'x', scope: 'elsewhere' })).status).toBe(400)
            expect((await json('/skill/source', 'PATCH', { path: 'relative/path', enabled: true })).status).toBe(400)
            expect((await json('/skill/source', 'PATCH', { path: join(discovery, 'missing'), enabled: true })).status).toBe(400)
            expect((await json('/skill/source', 'PATCH', { path: join(discovery, 'empty'), enabled: true })).status).toBe(400)
            // 白名单外（比如根目录或任意临时目录）不允许收为技能来源。
            expect((await json('/skill/source', 'PATCH', { path: tmpdir(), enabled: true })).status).toBe(400)
            expect((await request('/skill/read')).status).toBe(400)
            expect((await request('/skill/read?name=missing')).status).toBe(404)
        })
    })

    test('禁用的技能不进交给模型的清单，重新启用后回来', async () => {
        await withHome(async ({ project }) => {
            await writeSkill(join(process.env.AGENT_HOME, 'skills', 'review'), 'review', '审查改动', '第一步')
            await writeSkill(join(process.env.AGENT_HOME, 'skills', 'deploy'), 'deploy', '部署', '部署正文')

            const disabled = await (await json('/skill/toggle', 'PATCH', { name: 'review', enabled: false })).json()
            expect(disabled).toEqual({ name: 'review', enabled: false })

            expect((await Skill.list({ cwd: project, skills: SkillFeature })).map(item => item.name)).toEqual(['deploy'])
            // 管理页要能读到禁用的技能（enabled: false）才能重新打开；模型清单不含它，所以工具层读不到。
            const disabledSkill = await SkillFeature.read({ name: 'review', cwd: project })
            expect(disabledSkill.enabled).toBe(false)
            await expect(Skill.read({ name: 'review', cwd: project, skills: SkillFeature })).rejects.toThrow(/Skill not found/)

            const tool = await Skill.build({ cwd: project, skills: SkillFeature })
            expect(tool.description).toContain('deploy')
            expect(tool.description).not.toContain('review')

            const listed = await (await request(`/skill/list?cwd=${encodeURIComponent(project)}`)).json()
            expect(listed.skills.find(item => item.name === 'review').enabled).toBe(false)

            await json('/skill/toggle', 'PATCH', { name: 'review', enabled: true })
            expect((await Skill.list({ cwd: project, skills: SkillFeature })).map(item => item.name).sort()).toEqual(['deploy', 'review'])
        })
    })

    test('外部技能不能被删除，也不能把本应用目录当外部来源', async () => {
        await withHome(async ({ discovery }) => {
            const external = join(discovery, '.claude', 'skills')
            await writeSkill(join(external, 'lint'), 'lint', '检查代码', '运行 lint')
            await json('/skill/source', 'PATCH', { path: external, enabled: true })

            expect((await json('/skill/remove', 'POST', { name: 'lint' })).status).toBe(404)
            expect((await json('/skill/source', 'PATCH', { path: join(process.env.AGENT_HOME, 'skills'), enabled: true })).status).toBe(400)
        })
    })

    test('状态文件记录了启用的目录和禁用名单，重启后仍然有效', async () => {
        await withHome(async ({ discovery }) => {
            const external = join(discovery, '.claude', 'skills')
            await writeSkill(join(external, 'lint'), 'lint', '检查代码', '运行 lint')
            await writeSkill(join(process.env.AGENT_HOME, 'skills', 'review'), 'review', '审查', '正文')

            await json('/skill/source', 'PATCH', { path: external, enabled: true })
            await json('/skill/toggle', 'PATCH', { name: 'review', enabled: false })

            const state = JSON.parse(await readFile(join(process.env.AGENT_HOME, 'skills.json'), 'utf8'))
            expect(state.sources).toEqual([external])
            expect(state.disabled).toEqual(['review'])

            const skills = await (await request('/skill/list')).json()
            expect(skills.skills.map(item => item.name)).toEqual(['lint', 'review'])
            expect(skills.skills.find(item => item.name === 'review').enabled).toBe(false)
        })
    })

    test('技能工具会带上已启用外部目录里的技能', async () => {
        await withHome(async ({ discovery, project }) => {
            const external = join(discovery, '.claude', 'skills')
            await writeSkill(join(external, 'lint'), 'lint', '检查代码', '运行 lint')
            await json('/skill/source', 'PATCH', { path: external, enabled: true })

            const tool = await Skill.build({ cwd: project, skills: SkillFeature })
            expect(tool.description).toContain('lint')
            expect(await tool.execute({ name: 'lint' }, { cwd: project })).toBe('运行 lint')
        })
    })
})

describe('MCP 配置版本与 Agent 快照', () => {
    test('空闲 Agent 在 MCP 配置变化后重建', async () => {
        await withHome(async ({ project }) => {
            await Config.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'ask' } })
            const { sessionId } = await Session.create({ title: 'MCP revision', cwd: project })
            const before = await Assemble.get({ sessionId })
            const version = Mcp.revision()

            await Mcp.save({ name: 'disabled-test', definition: { command: 'bun', enabled: false } })
            expect(Mcp.revision()).toBe(version + 1)
            const after = await Assemble.get({ sessionId })
            expect(after).not.toBe(before)
            expect(after.mcpRevision).toBe(Mcp.revision())

            await Mcp.remove({ name: 'disabled-test' })
            await Mcp.close()
        })
    })

    test('运行中的 Agent 保持旧快照，结束后再重建', async () => {
        await withHome(async ({ project }) => {
            await Config.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'ask' } })
            const { sessionId } = await Session.create({ title: 'MCP running', cwd: project })
            const before = await Assemble.get({ sessionId })
            before.running = {}                                      // 模拟这一轮还没结束

            await Mcp.save({ name: 'disabled-test', definition: { command: 'bun', enabled: false } })
            expect(await Assemble.get({ sessionId })).toBe(before)
            expect(before.stale).toBe(true)

            before.running = null
            await Assemble.settle(sessionId)
            expect(Agent.runtime().get(sessionId)).toBeUndefined()
            expect(await Assemble.get({ sessionId })).not.toBe(before)

            await Mcp.remove({ name: 'disabled-test' })
            await Mcp.close()
        })
    })
})

describe('能力接口装配', () => {
    test('会话装配后技能清单跟着目录里的技能走', async () => {
        await withHome(async ({ project }) => {
            await writeSkill(join(project, '.agent', 'skills', 'local'), 'local', '本地技能', '正文')
            await Config.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'ask' } })
            const { sessionId } = await Session.create({ title: '技能会话', cwd: project })
            const agent = Agent.runtime().get(sessionId)
            expect(agent.tools.schema.skill.description).toContain('local')
        })
    })

    test('管理总线接住了所有能力动作', async () => {
        const routes = app.routes.map(route => `${route.method.toUpperCase()} ${route.path}`)
        expect(routes).toContain('POST /admin')
        const admin = (await import('../commands/admin.js')).default
        for (const op of ['mcp.list', 'mcp.save', 'mcp.import', 'mcp.remove', 'mcp.toggle', 'mcp.test',
            'skill.list', 'skill.read', 'skill.save', 'skill.remove', 'skill.toggle', 'skill.source']) {
            expect(Object.keys(admin.OPS)).toContain(op)
        }
    })
})
