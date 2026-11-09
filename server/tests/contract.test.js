/*
 * 契约一致性检查：几处需要互相说同一件事的地方，改了一处忘了另一处就会失败。
 *
 * 版本号、工具目录、按任务的模型、结束工具名单、API 路径、SSE 事件，都靠这里盯着。
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
    // 路由集合不再有第二份文档：server.js 是唯一来源，前端的 mock 和协议测试
    // 直接解析它（见 frontend/tests/server-routes.js）；这里只管服务端自己能自证的部分。
    test('健康检查报的版本就是 package.json 里的版本', async () => {
        const pkg = await readJson('package.json')
        const response = await app.handle(new Request('http://localhost/health'))
        expect((await response.json()).version).toBe(pkg.version)
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
            '.gitignore', '.vscode', 'README.md', 'bun.lock', 'bunfig.toml', 'commands', 'dist', 'features',
            'node_modules', 'package.json', 'server.js', 'store.js', 'tests', 'tools', 'utils',
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
    test('后端自己发的每个事件类型都写进了 README 的事件表', async () => {
        const sources = ['commands/chat.js', 'features/approval.js', 'features/mcp.js', 'features/history.js']
        const sent = new Set()
        for (const name of sources) {
            const code = await source(name)
            for (const [, type] of code.matchAll(/data: \{ type: '([a-z][a-z-]+)'/g)) sent.add(type)
        }

        // 事件清单只存在 README 一处：新加事件不写进去，这条会红。
        const readme = await source('README.md')
        expect([...sent].filter(type => !readme.includes(type))).toEqual([])
    })
})
