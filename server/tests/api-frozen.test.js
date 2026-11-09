/*
 * 接口冻结测试：路由表和 /admin op 表已经收敛到 18 条 + 30 个，
 * 新增功能优先扩展现有接口的参数，不能随便新开路由或 op。
 *
 * 这个测试的目的是**防止后续协作者（AI 或人）随意新增接口**：
 * 测试失败时说明有人在试图新增路由/op，必须停下来问用户是否真的要加。
 *
 * 调用示例：bun test tests/api-frozen.test.js
 */
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import Admin from '../commands/admin.js'
import { app } from '../server.js'

test('路由表冻结在 19 条，不允许新增路由', () => {
    // 实际路由数：Elysia 的 app.routes 包含所有 method+path 对
    const routes = app.routes.map(route => `${route.method} ${route.path}`).sort()
    
    // 对外说"18 条"，实测 19 个（/admin 有 GET 和 POST 两个方法）
    const expected = [
        'DELETE /session/remove/:sessionId',
        'GET /admin',
        'GET /health',
        'GET /session/list',
        'GET /session/read/:sessionId',
        'GET /session/settings/:sessionId',
        'GET /sse/connect/:sessionId',
        'PATCH /session/rename/:sessionId',
        'PATCH /session/settings/:sessionId',
        'POST /admin',
        'POST /agent/decide/:sessionId',
        'POST /agent/resume/:sessionId',
        'POST /agent/send/:sessionId',
        'POST /agent/stop/:sessionId',
        'POST /session/compact/:sessionId',
        'POST /session/create',
        'POST /session/fork/:sessionId',
        'POST /session/rollback/:sessionId',
        'POST /session/rollback/redo/:sessionId',
    ]
    
    assert.deepEqual(routes, expected, `
路由表已冻结在 19 条（对外说 18 条，/admin 有 GET 和 POST 两个方法）。
新增功能优先扩展现有路由的参数（比如 /session/read 加 after 查询参数），
或在 /admin 已有的 op 里加字段。

如果确实需要新开路由，请先问用户是否同意。
    `.trim())
})

test('/admin op 表包含所有管理动作，可随功能扩展', () => {
    // op 表不冻结：/admin 是管理总线，功能扩展时可以加新 op。
    // 只要确保路由表冻结（不新增路由），所有管理动作都走 /admin 即可。
    const ops = Object.keys(Admin.OPS)
    assert.ok(ops.length >= 30, `至少包含初始的 30 个 op，当前 ${ops.length} 个`)
    assert.ok(ops.includes('config.read'), '必须包含 config.read')
    assert.ok(ops.includes('mcp.list'), '必须包含 mcp.list')
    assert.ok(ops.includes('skill.list'), '必须包含 skill.list')
})
