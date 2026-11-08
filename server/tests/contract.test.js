/*
 * 契约一致性检查：几处需要互相说同一件事的地方，改了一处忘了另一处就会失败。
 *
 * 路由 / 接口文档 / 版本号、工具目录 / 工具文件、按任务的模型 / 文档，都靠这里盯着。
 * 运行：cd server && bun test
 */

import { describe, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { app } from '../server.js'
import Settings from '../commands/settings.js'
import store from '../store.js'
import Tool from '../features/tool.js'

const source = name => Bun.file(fileURLToPath(new URL(`../${name}`, import.meta.url))).text()
const readJson = name => Bun.file(fileURLToPath(new URL(`../${name}`, import.meta.url))).json()

describe('接口契约', () => {
    // 原来的三条断言（每个路由都有文档、文档里的路由都存在、每条有 summary/operationId/responses）
    // 现在全部由生成器一次担保：scripts/openapi.js 把 server.js 的注册和 api.js 的说明
    // 摆在一起对账，少一条、多一条、缺字段都直接报错退出。
    // 这里只需确认“提交的 openapi.json 就是当前代码的产物”。
    test('openapi.json 和当前代码一致（改了接口要重新生成）', () => {
        const result = Bun.spawnSync([process.execPath, 'scripts/openapi.js', '--check'], {
            cwd: fileURLToPath(new URL('../', import.meta.url)),
            stdout: 'pipe',
            stderr: 'pipe',
        })
        expect(result.stderr.toString().trim(), '跑 bun run openapi 重新生成').toBe('')
        expect(result.exitCode).toBe(0)
    })

    test('接口文档的版本和后端版本一致', async () => {
        const [openapi, pkg] = await Promise.all([readJson('openapi.json'), readJson('package.json')])
        expect(openapi.info.version).toBe(pkg.version)
    })

    test('健康检查报的版本就是 package.json 里的版本', async () => {
        const pkg = await readJson('package.json')
        const response = await app.handle(new Request('http://localhost/health'))
        expect((await response.json()).version).toBe(pkg.version)
    })

    test('按任务的模型和文档里的是同一组', async () => {
        const openapi = await readJson('openapi.json')
        const models = openapi.components.schemas.Config.properties.models.properties
        expect(Object.keys(models)).toEqual(Settings.MODELS.map(item => item.task))
    })

    test('界面上的工具类别和代码里的类别是同一组', async () => {
        const response = await app.handle(new Request('http://localhost/tool/kinds'))
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(Tool.KINDS)
    })

    test('界面上按任务配模型的下拉框和代码里的用途是同一组', async () => {
        const response = await app.handle(new Request('http://localhost/config/meta'))
        expect(response.status).toBe(200)
        expect((await response.json()).models).toEqual(Settings.MODELS)
    })

    test('前端的结束工具名单和服务端一致', async () => {
        const [control, stopTools] = await Promise.all([
            source('tools/control.js'),
            source('../frontend/src/features/turns.js'),      // 结束工具名单住在 features/turns.js
        ])
        const serverStops = [...control.matchAll(/name: '([^']+)'/g)].map(match => match[1]).sort()
        const stopBlock = stopTools.slice(stopTools.indexOf('STOP_TOOLS = new Set(['), stopTools.indexOf('])', stopTools.indexOf('STOP_TOOLS = new Set([')))
        const frontendStops = [...stopBlock.matchAll(/'([^']+)'/g)].map(match => match[1]).sort()
        expect(frontendStops).toEqual(serverStops)
    })

    test('前端发审批决定时用的字段名和后端读的一致', async () => {
        const root = new URL('../../', import.meta.url)
        const [frontend, backend] = await Promise.all([
            Bun.file(fileURLToPath(new URL('frontend/src/utils/api.js', root))).text(),
            Bun.file(fileURLToPath(new URL('server/features/approval.js', root))).text(),
        ])
        const sentBody = frontend.match(/decideTool:[^\n]*\{\s*([A-Za-z]+),\s*decision\s*\}/)?.[1]
        const readField = backend.match(/decide = async \(\{ sessionId, ([A-Za-z]+), decision \}\)/)?.[1]
        expect(sentBody).toBeTruthy()
        expect(sentBody).toBe(readField)
    })
})

describe('项目结构', () => {
    test('根目录只有入口、数据文件和固定几个目录', async () => {
        const entries = await readdir(fileURLToPath(new URL('../', import.meta.url)))
        const allowed = new Set([
            '.gitignore', '.vscode', 'README.md', 'api.js', 'bun.lock', 'bunfig.toml', 'commands', 'dist', 'features',
            'node_modules', 'openapi.json', 'package.json', 'scripts', 'server.js', 'store.js', 'tests', 'tools', 'utils',
        ])
        // 这些是跑工具时自动生成的产物目录（已在 .gitignore 里），不属于手写源码。
        // 不能因为“目录里多了一个工具产物”就让结构检查变红，否则开发者每次跑完
        // 浏览器检查都要先手动删目录才能提交。
        const generated = new Set(['.playwright-mcp'])
        expect(entries.filter(entry => !allowed.has(entry) && !generated.has(entry))).toEqual([])
    })

    test('直接 import 命令的测试都经过服务入口装配', async () => {
        const directory = fileURLToPath(new URL('./', import.meta.url))
        const files = (await readdir(directory)).filter(name => name.endsWith('.test.js'))
        for (const file of files) {
            const code = await Bun.file(new URL(`./${file}`, import.meta.url)).text()
            if (!code.includes("from '../commands/")) continue
            // 有状态服务只在 server.js 装配；漏了它，单独跑这个文件时命令会缺依赖。
            expect(code.includes("'../server.js'"), `${file} 没 import ../server.js`).toBe(true)
        }
    })

    test('store 只放全局配置和会话两份数据', async () => {
        expect(Object.keys(store).sort()).toEqual(['config', 'sessions'])
        expect(store.config.models).toBeDefined()
        expect(store.sessions).toBeDefined()
    })

    test('工具目录只有按类别分组的文件', async () => {
        const files = (await readdir(fileURLToPath(new URL('../tools/', import.meta.url)))).filter(name => name.endsWith('.js')).sort()
        expect(files).toEqual(['background.js', 'context.js', 'control.js', 'file.js', 'history.js', 'shell.js', 'skill.js', 'todo.js', 'web.js'])
    })

    test('每个工具文件里的工具都声明了名称、类别、说明和参数', async () => {
        const directory = fileURLToPath(new URL('../tools/', import.meta.url))
        const tools = []
        for (const file of (await readdir(directory)).filter(name => name.endsWith('.js'))) {
            const module = await import(new URL(`../tools/${file}`, import.meta.url).href)
            for (const tool of [module.default].flat()) {
                if (!tool?.name || typeof tool.execute !== 'function') continue
                tools.push({ file, tool })
            }
        }
        expect(tools.length).toBeGreaterThan(0)
        for (const { file, tool } of tools) {
            expect(tool.name, file).toBeTruthy()
            expect(tool.kind, `${file}:${tool.name}`).toBeTruthy()
            expect(tool.description, `${file}:${tool.name}`).toBeTruthy()
            expect(tool.inputSchema, `${file}:${tool.name}`).toBeTruthy()
        }
    })
})

describe('SSE 事件', () => {
    test('后端自己发的每个事件类型都写进了接口文档的说明', async () => {
        const sources = ['commands/chat.js', 'features/approval.js', 'features/mcp.js', 'features/history.js']
        const sent = new Set()
        for (const name of sources) {
            const code = await source(name)
            for (const [, type] of code.matchAll(/data: \{ type: '([a-z][a-z-]+)'/g)) sent.add(type)
        }

        // 事件清单只存在于一处：api.js 里 /sse/connect 的 description。
        // 不再维护第二份手写事件表——两份表格必然漂移。
        const { paths } = await import('../api.js')
        const description = paths['/sse/connect/{sessionId}'].get.description
        expect([...sent].filter(type => !description.includes(type))).toEqual([])
    })
})
