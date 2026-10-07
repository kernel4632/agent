/*
 * 契约一致性检查：后端路由、接口文档、版本号三处必须说同一件事。
 *
 * 这三处任何一处改了另两处没跟上，下次接手的人就会按错的名字写代码。
 * 手工核对靠不住，所以让测试来盯。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { app } from '../server.js'

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

    test('健康检查报的版本就是 package.json 里的版本', async () => {
        const pkg = await readJson('package.json')
        const response = await app.handle(new Request('http://localhost/health'))
        expect((await response.json()).version).toBe(pkg.version)
    })
})
