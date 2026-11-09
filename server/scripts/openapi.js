/*
 * 生成 openapi.json：把 api.js 的内容和 server.js 实际注册的路由合成一份文档。
 *
 * 为什么需要生成而不是手写：
 *   - 手写的 JSON 里版本号和 package.json 会脱钩（曾经停在 0.82.0 而代码已到 0.84.1）；
 *   - 新增路由容易忘补文档，删掉路由又会留下幽灵条目；
 *   - 手写 JSON 的缩进和字段顺序每次 diff 都是一大片噪音。
 *
 * 生成时的三个硬约束（任一不满足就报错退出，不写出半份文档）：
 *   1. server.js 里的每个路由都必须在 api.js 里有说明；
 *   2. api.js 里不能有 server.js 里不存在的路由；
 *   3. 每条说明必须有 summary / operationId / responses。
 *
 * 用法：
 *   cd server && bun run openapi         # 生成并写回 openapi.json
 *   cd server && bun run openapi --check # 只检查是否过期，不写文件（CI 用）
 *
 * 产物是可提交的：openapi.json 跟着代码走，前端和外部使用者不需要装依赖就能读。
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { paths as documented, info, servers, tags, components } from '../api.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const openapiPath = new URL('../openapi.json', import.meta.url)

// --- 从 server.js 取出实际注册的路由 ---
// 只 import 应用对象，不启动监听：server.js 的 start() 只在 main 里跑。
const { app } = await import('../server.js')

const actualRoutes = () => {
    const seen = new Set()
    for (const route of app.routes) {
        // Elysia 把 /session/:id 记成 /session/:id，文档用 /session/{id}
        const path = route.path.replace(/:([^/]+)/g, '{$1}')
        seen.add(`${route.method.toUpperCase()} ${path}`)
    }
    return seen
}

const documentedRoutes = () => {
    const seen = new Set()
    for (const [path, methods] of Object.entries(documented)) {
        for (const method of Object.keys(methods)) {
            seen.add(`${method.toUpperCase()} ${path}`)
        }
    }
    return seen
}

// --- 校验：两边必须完全对上 ---
const missing = [...actualRoutes()].filter(route => !documentedRoutes().has(route)).sort()
const ghost = [...documentedRoutes()].filter(route => !actualRoutes().has(route)).sort()

const problems = []
if (missing.length) {
    problems.push(`server.js 里有、api.js 里没写说明的路由：\n${missing.map(route => `  - ${route}`).join('\n')}`)
}
if (ghost.length) {
    problems.push(`api.js 里有、server.js 里不存在的路由（删路由时忘了同步）：\n${ghost.map(route => `  - ${route}`).join('\n')}`)
}

// 每条说明的必备字段
for (const [path, methods] of Object.entries(documented)) {
    for (const [method, definition] of Object.entries(methods)) {
        for (const field of ['summary', 'operationId', 'responses']) {
            if (!definition?.[field]) problems.push(`${method.toUpperCase()} ${path} 缺少 ${field}`)
        }
    }
}

if (problems.length) {
    console.error('openapi 生成失败：\n\n' + problems.join('\n\n'))
    process.exit(1)
}

// --- 版本号只从 package.json 取 ---
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

// 路径排序：先按分组（tags 第一项），再按路径，保证 diff 稳定
const tagOrder = new Map(tags.map((tag, index) => [tag.name, index]))
const rank = definition => {
    const first = definition?.tags?.[0]
    return tagOrder.has(first) ? tagOrder.get(first) : tagOrder.size
}
const sortedPaths = Object.fromEntries(
    Object.entries(documented).sort(([pathA, a], [pathB, b]) => {
        const firstA = Object.values(a)[0]
        const firstB = Object.values(b)[0]
        return rank(firstA) - rank(firstB) || pathA.localeCompare(pathB)
    }),
)

const spec = {
    openapi: '3.1.0',
    info: { title: info.title, version: pkg.version, description: info.description },
    servers,
    tags,
    paths: sortedPaths,
    components,
}

const next = `${JSON.stringify(spec, null, 2)}\n`
const previous = await readFile(openapiPath, 'utf8').catch(() => '')

if (process.argv.includes('--check')) {
    if (previous !== next) {
        console.error('openapi.json 已过期：跑 `cd server && bun run openapi` 重新生成。')
        process.exit(1)
    }
    console.log('openapi.json 是最新的。')
    process.exit(0)
}

if (previous === next) {
    console.log('openapi.json 无变化。')
    process.exit(0)
}

await writeFile(openapiPath, next)
console.log(`openapi.json 已更新：${Object.keys(sortedPaths).length} 条路径，版本 ${pkg.version}`)
