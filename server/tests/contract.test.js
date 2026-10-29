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
import Config from '../commands/config.js'
import store from '../store.js'
import Tool from '../features/tool.js'

const source = name => Bun.file(fileURLToPath(new URL(`../${name}`, import.meta.url))).text()
const readJson = name => Bun.file(fileURLToPath(new URL(`../${name}`, import.meta.url))).json()

// --- 从 Elysia 应用里取出全部路由 ---
const routes = () => app.routes.map(route => ({
    path: route.path.replace(/:([^/]+)/g, '{$1}'),
    method: route.method.toUpperCase(),
}))

describe('接口契约', () => {
    test('每个后端路由都在接口文档里写着', async () => {
        const openapi = await readJson('openapi.json')
        const documented = new Set(Object.keys(openapi.paths))
        expect(routes().filter(route => !documented.has(route.path))).toEqual([])
    })

    test('接口文档里写着的每个地址都真的存在', async () => {
        const openapi = await readJson('openapi.json')
        const actual = new Set(routes().map(route => route.path))
        expect(Object.keys(openapi.paths).filter(path => !actual.has(path))).toEqual([])
    })

    test('接口文档里每个地址都写了方法、操作名和响应', async () => {
        const openapi = await readJson('openapi.json')
        for (const [path, methods] of Object.entries(openapi.paths)) {
            for (const [method, definition] of Object.entries(methods)) {
                expect(definition.summary, `${method} ${path} 少了 summary`).toBeTruthy()
                expect(definition.operationId, `${method} ${path} 少了 operationId`).toBeTruthy()
                expect(definition.responses, `${method} ${path} 少了 responses`).toBeTruthy()
            }
        }
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

    test('自动批准的类别和文档里的是同一组', async () => {
        const openapi = await readJson('openapi.json')
        expect(Object.keys(openapi.components.schemas.AutoApprove.properties)).toEqual(Tool.KINDS.map(item => item.kind))
    })

    test('按任务的模型和文档里的是同一组', async () => {
        const openapi = await readJson('openapi.json')
        const models = openapi.components.schemas.Config.properties.models.properties
        expect(Object.keys(models)).toEqual(Config.MODELS.map(item => item.task))
    })

    test('界面上的自动批准开关和代码里的类别是同一组', async () => {
        const response = await app.handle(new Request('http://localhost/tool/kinds'))
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(Tool.KINDS)
    })

    test('界面上按任务配模型的下拉框和代码里的用途是同一组', async () => {
        const response = await app.handle(new Request('http://localhost/config/meta'))
        expect(response.status).toBe(200)
        expect((await response.json()).models).toEqual(Config.MODELS)
    })

    test('前端的结束工具名单和服务端一致', async () => {
        const [control, stopTools] = await Promise.all([
            source('tools/control.js'),
            source('../frontend/src/session/stop-tools.js'),
        ])
        const serverStops = [...control.matchAll(/name: '([^']+)'/g)].map(match => match[1]).sort()
        const stopBlock = stopTools.slice(stopTools.indexOf('STOP_TOOLS = new Set(['), stopTools.indexOf('])', stopTools.indexOf('STOP_TOOLS = new Set([')))
        const frontendStops = [...stopBlock.matchAll(/'([^']+)'/g)].map(match => match[1]).sort()
        expect(frontendStops).toEqual(serverStops)
    })

    test('前端发审批决定时用的字段名和后端读的一致', async () => {
        const root = new URL('../../', import.meta.url)
        const [frontend, backend] = await Promise.all([
            Bun.file(fileURLToPath(new URL('frontend/src/api.js', root))).text(),
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
            '.gitignore', '.vscode', 'README.md', 'bun.lock', 'commands', 'dist', 'features',
            'node_modules', 'openapi.json', 'package.json', 'server.js', 'store.js', 'tests', 'tools', 'utils',
        ])
        expect(entries.filter(entry => !allowed.has(entry))).toEqual([])
    })

    test('store 只放全局配置和会话两份数据', async () => {
        expect(Object.keys(store).sort()).toEqual(['config', 'sessions'])
        expect(store.config.models).toBeDefined()
        expect(store.sessions).toBeDefined()
    })

    test('工具目录只有按类别分组的文件', async () => {
        const files = (await readdir(fileURLToPath(new URL('../tools/', import.meta.url)))).filter(name => name.endsWith('.js')).sort()
        expect(files).toEqual(['control.js', 'cwd.js', 'file.js', 'shell.js', 'skill.js', 'subagent.js', 'todo.js', 'web.js'])
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
    test('后端自己发的每个事件类型都在对接文档里写着', async () => {
        const sources = ['features/run.js', 'features/approval.js', 'features/mcp.js', 'tools/subagent.js']
        const sent = new Set()
        for (const name of sources) {
            const code = await source(name)
            for (const [, type] of code.matchAll(/data: \{ type: '([a-z][a-z-]+)'/g)) sent.add(type)
        }

        const documented = await source('README.md')
        expect([...sent].filter(type => !documented.includes(type))).toEqual([])
    })
})
