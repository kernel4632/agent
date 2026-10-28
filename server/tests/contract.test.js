/*
 * 契约一致性检查：几处需要互相说同一件事的地方，改了一处忘了另一处就会失败。
 *
 * 路由 / 接口文档 / 版本号，工具目录 / 忽略规则名单，前后端请求字段，都靠这里盯着。
 * 手工核对靠不住，所以让测试来盯。
 * 运行：cd server && bun test
 */

import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import Agent from '@kernel4632/agent-core'
import { app } from '../server.js'
import { fileToolNames } from '../tool-registry/files.js'
import Kind, { KINDS } from '../tool-registry/kind.js' // 工具类别由工具自己声明，扫描时登记。
import ToolCatalog from '../tool-registry/catalog.js' // 扫描后才有类别和文件参数。
import { USES } from '../config/settings.js' // 哪件事可以单独配模型，文档跟着它走。

// 从仓库里读一个文件，契约检查都建立在"以代码为准"上。
const source = name => Bun.file(fileURLToPath(new URL(`../${name}`, import.meta.url))).text()

// --- 从 Elysia 应用里取出全部路由 ---
const routes = () => app.routes.map(route => ({
    // 路由里的 :参数 和文档里的 {参数} 是同一样东西，统一成 {参数} 再比。
    path: route.path.replace(/:([^/]+)/g, '{$1}'),
    method: route.method.toUpperCase(),
}))

// JSON 在用到的时候才读：版本号变了要立刻反映，不在模块加载时先卡住。
const readJson = name => Bun.file(fileURLToPath(new URL(`../${name}`, import.meta.url))).json()

describe('接口契约', () => {
    test('每个后端路由都在接口文档里写着', async () => {
        const openapi = await readJson('openapi.json')
        const documented = new Set(Object.keys(openapi.paths))
        // 没有出现在文档里的路由：要么补文档，要么删掉。
        expect(routes().filter(route => !documented.has(route.path))).toEqual([])
    })

    test('接口文档里写着的每个地址都真的存在', async () => {
        const openapi = await readJson('openapi.json')
        const actual = new Set(routes().map(route => route.path))
        // 文档里写着但后端没有：调用方会照着写，然后拿到 404。
        expect(Object.keys(openapi.paths).filter(path => !actual.has(path))).toEqual([])
    })

    test('接口文档里每个地址都写了方法、操作名和响应', async () => {
        const openapi = await readJson('openapi.json')
        for (const [path, methods] of Object.entries(openapi.paths)) {
            for (const [method, definition] of Object.entries(methods)) {
                // 少了这些，生成的文档和 SDK 就用不了。
                expect(definition.summary, `${method} ${path} 少了 summary`).toBeTruthy()
                expect(definition.operationId, `${method} ${path} 少了 operationId`).toBeTruthy()
                expect(definition.responses, `${method} ${path} 少了 responses`).toBeTruthy()
            }
        }
    })
    test('接口文档的版本和后端版本一致', async () => {
        const [openapi, pkg] = await Promise.all([readJson('openapi.json'), readJson('package.json')])
        // 两处版本不一致时，前端没法靠 /health 判断自己连的是哪一版。
        expect(openapi.info.version).toBe(pkg.version)
    })

    test('前端的结束工具名单和服务端一致', async () => {
        const [completion, followup, stopTools] = await Promise.all([
            source('tools/attempt-completion.js'),
            source('tools/ask-followup.js'),
            source('../frontend/src/session/stop-tools.js'),
        ])
        const serverStops = [...`${completion}\n${followup}`.matchAll(/name: '([^']+)'/g)].map(match => match[1]).sort()
        const stopBlock = stopTools.slice(stopTools.indexOf('STOP_TOOLS = new Set(['), stopTools.indexOf('])', stopTools.indexOf('STOP_TOOLS = new Set([')))
        const frontendStops = [...stopBlock.matchAll(/'([^']+)'/g)].map(match => match[1]).sort()
        // 结束工具一改，前端就会把“任务完成”误判成“需要继续”；两边必须完全相等，不能只查一个方向。
        expect(frontendStops).toEqual(serverStops)
    })

    test('自动批准的类别和代码里的类别是同一组', async () => {
        const openapi = await readJson('openapi.json')
        // 文档和代码的类别对不上时，前端会多画一个永远不生效的开关（或者少画一个真有用的）。
        // 类别名单只有 tool-registry/kind.js 一处，文档跟着它走。
        expect(Object.keys(openapi.components.schemas.AutoApprove.properties)).toEqual(KINDS.map(item => item.kind))
    })

    test('文档里"按用途配模型"的那几项和代码是同一组', async () => {
        const openapi = await readJson('openapi.json')
        // 少写一项，用户就永远配不了那个用途的模型，而且界面上看不出来。
        const settings = openapi.components.schemas.Session.allOf[1].properties.settings.properties
        expect(Object.keys(settings.uses.properties)).toEqual(USES.map(item => item.use))
        // 上限和自动标题也得在文档里，前端照着写才不用猜默认值。
        expect(settings.autoApproveLimit.type).toBe('number')
        expect(settings.autoTitle.type).toBe('boolean')
    })

    test('界面上的自动批准开关和代码里的类别是同一组', async () => {
        // 前端不再存类别清单，开关直接按 /tool/kinds 生成；这里确认接口和代码同源。
        const response = await app.handle(new Request('http://localhost/tool/kinds'))
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(KINDS)
    })

    test('界面上"按用途配模型"的下拉框和代码里的用途是同一组', async () => {
        // 前端不再存用途表，直接消费 /config/meta；这里确认接口和代码同源。
        const response = await app.handle(new Request('http://localhost/config/meta'))
        expect(response.status).toBe(200)
        expect((await response.json()).uses).toEqual(USES)
    })

    test('每个类别在界面上都配了图标', async () => {
        const frontend = await source('../frontend/src/session/session.js')
        // 缺图标时 AppIcon 会退回默认的 spark，看着像是"这个开关还没做完"。
        const start = frontend.indexOf('const KIND_ICONS')
        const block = frontend.slice(start, frontend.indexOf('}', start))
        const icons = [...block.matchAll(/(\w+): '([a-z]+)'/g)].map(([, kind, icon]) => ({ kind, icon }))
        expect(icons.map(item => item.kind)).toEqual(KINDS.map(item => item.kind))
        // 图标名得在 AppIcon 里真的存在，不然渲染出来是一个空形状。
        const iconComponent = await source('../frontend/src/ui/AppIcon.vue')
        for (const { icon } of icons) expect(iconComponent, `AppIcon 里没有 ${icon}`).toMatch(new RegExp(`(?:^|\\n)\\s*'?${icon}'?\\s*:`))
    })

    test('健康检查报的版本就是 package.json 里的版本', async () => {
        const pkg = await readJson('package.json')
        const response = await app.handle(new Request('http://localhost/health'))
        expect((await response.json()).version).toBe(pkg.version)
    })
})

// --- 工具与忽略规则 ---
// tools/ 里每个工具的说明，用来判断它碰不碰文件。
const toolDefinitions = async () => {
    await ToolCatalog.register()
    const tools = await Agent.tool.scan(fileURLToPath(new URL('../tools/', import.meta.url)))
    return tools.schema
}

// --- SSE 事件 ---
describe('SSE 事件', () => {
    test('后端自己发的每个事件类型都在对接文档里写着', async () => {
        // 从源码里提取，不另维护一份清单——清单会漂移，这正是要防的问题。
        const sources = ['conversation/session.js', 'safety/approval.js', 'tool-registry/mcp.js', 'agent/subtask.js']
        const sent = new Set()
        for (const name of sources) {
            const code = await source(name)
            // 只认 SSE 事件：它们都写成 data 里带一个 type 字段，
            // 内容块里的 type（'text'、'object' 那些）不算。
            for (const [, type] of code.matchAll(/data: \{ type: '([a-z][a-z-]+)'/g)) sent.add(type)
        }

        const documented = await source('README.md')
        // 少写一个，前端就不知道要处理它，用户界面上表现为"什么都没发生"。
        expect([...sent].filter(type => !documented.includes(type))).toEqual([])
    })
})
// --- 前后端请求字段 ---
describe('请求字段', () => {
    test('前端发审批决定时用的字段名和后端读的一致', async () => {
        // 这两个名字对不上时后端只是返回 ok:false，没有任何报错，
        // 表现是"点了允许但工具一直没动"，很难查。所以在这里固定住。
        // 仓库根目录按测试文件自己的位置推，不看运行目录在哪。
        const root = new URL('../../', import.meta.url)
        const [frontend, backend] = await Promise.all([
            Bun.file(fileURLToPath(new URL('frontend/src/api.js', root))).text(),
            Bun.file(fileURLToPath(new URL('server/conversation/session.js', root))).text(),
        ])
        const sentBody = frontend.match(/decideTool:[^\n]*\{\s*([A-Za-z]+),\s*decision\s*\}/)?.[1]
        const readField = backend.match(/decide\(\{\s*sessionId,\s*([A-Za-z]+),\s*decision\s*\}\)/)?.[1]
        expect(sentBody).toBeTruthy() // 前端没有这个调用时，这条检查本身就该报出来。
        expect(sentBody).toBe(readField)
    })
})

describe('工具名单', () => {
    test('忽略规则登记的文件工具都真的存在', async () => {
        const schema = await toolDefinitions()
        // 名单里写着一个已经删掉的工具名，说明名单没跟着清理。
        const registered = fileToolNames()
        expect(registered.filter(name => !(name in schema))).toEqual([])
    })

    test('碰文件的工具都登记进了忽略规则', async () => {
        const schema = await toolDefinitions()
        // 判断一个工具碰不碰文件，看它的参数里有没有 path、file_path 或 patches——
        // 这是"能不能绕过 .agentignore 读到密钥"的唯一线索。
        const touchesFiles = Object.entries(schema)
            .filter(([, tool]) => {
                const properties = tool.inputSchema?.jsonSchema?.properties || tool.inputSchema?.properties || {}
                return 'path' in properties || 'file_path' in properties || 'patches' in properties
            })
            .map(([name]) => name)

        // 漏登记的工具能读到 .env，而忽略规则完全不知道它存在。
        const registered = fileToolNames()
        expect(touchesFiles.filter(name => !registered.includes(name))).toEqual([])
    })

    test('每个内置工具都在自己的文件里声明了类别', async () => {
        const schema = await toolDefinitions()
        // 类别表由扫描器从工具文件收集。漏了 kind 不会报错，
        // 表现是"这个工具永远要问用户"，很难联想到是忘了声明。
        const registered = Kind.registered()
        const missing = Object.keys(schema).filter(name => !registered.has(name))
        expect(missing).toEqual([])
    })

    test('自动批准的刹车在文档里写的是单个数字', async () => {
        const openapi = await readJson('openapi.json')
        const settings = openapi.components.schemas.Session.allOf[1].properties.settings.properties
        // 之前写成 { requests, cost } 两个数字，cost 那档没有意义（用户都是无限 token），
        // 收成单个数字后文档也得跟着变，不然前端照着旧形状写就是坏的。
        expect(settings.autoApproveLimit.type).toBe('number')
    })
})
