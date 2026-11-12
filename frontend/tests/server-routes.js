/*
 * 测试用的路由表：直接从 server/server.js 的真实注册里读，不再维护第二份接口清单。
 *
 * 为什么这么来：mock 后端要保证「不会响应后端已经不存在的接口」，协议测试要保证
 * 「前端调用的路径真实存在」。这两件事都需要当前路由集合，而唯一权威是 server.js。
 * 之前读的是 openapi.json，现在文档删掉了，这里改成解析注册语句本身：
 *   app.group('/session', session => ...)  → 前缀 /session
 *   .get('/read/:sessionId', ...)         → GET /session/read/{sessionId}
 *
 * 解析失败不会静默：路由数量为 0 时 mock 会把所有请求判成 404，界面测试立刻红。
 */

import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../server/server.js', import.meta.url), 'utf8')

const chained = /^\s*\.(get|post|put|patch|delete)\(\s*'([^']+)'/
const root = /^app\.(get|post|put|patch|delete)\(\s*'([^']+)'/

export const serverRoutes = []
let prefix = ''
for (const line of source.split('\n')) {
    const group = line.match(/app\.group\(\s*'([^']+)'/)
    if (group) {
        prefix = group[1]
        continue
    }
    // 顶层注册复位前缀，避免上一条 group 的路径串到下一条上。
    if (root.test(line)) prefix = ''
    const hit = line.match(chained) || line.match(root)
    if (!hit) continue
    const path = `${prefix}${hit[2]}`.replace(/:([^/]+)/g, '{$1}')
    serverRoutes.push({ method: hit[1].toUpperCase(), path })
}

/** 把 /session/read/{sessionId} 变成可以匹配真实请求路径的正则。 */
export const patternOf = path => new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`)

if (!serverRoutes.length) throw new Error('没能从 server/server.js 里解析出任何路由')
