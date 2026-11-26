/*
架构图的数据源：扫描 backend / web/src / extensions，产出「文件节点 + 边 + 违规」。
边分七类：import（静态导入）、patch（扩展包宿主方法）、inject（宿主反向注入）、
http（前后端接口）、manifest（扩展 requires/after）、tool（扩展登记工具）、use（扩展间 expose/use）。
规则检查也从这里取数：循环依赖、扩展绕过 ctx、组件绕过 Agent、fetch 出口唯一。
用 Bun 自带 Transpiler 扫 import，不引第三方解析库；type import 只参与规则、不画图。
*/

import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, dirname } from 'node:path'
import { KEYWORDS, CONSTANT, sliceObject, topMembers } from './slice.js'

const ROOT = resolve(import.meta.dir, '..')
const TRANSPILE = { js: new Bun.Transpiler({ loader: 'js' }), ts: new Bun.Transpiler({ loader: 'ts' }) }

export const KIND_COLOR = {
    import: '#7a8ba8', patch: '#e05252', inject: '#9a5fb5', http: '#f28c28',
    manifest: '#4caf7d', tool: '#4caf7d', use: '#d9a520',
}

// 运行代码的范围；backend/tests 不画图也不查（测试引用宿主是天经地义的）。
const SCANS = [
    { dir: 'backend', area: 'backend', take: file => file.endsWith('.js') && !file.includes('/tests/') },
    { dir: 'web/src', area: 'web', take: file => /\.(ts|vue)$/.test(file) },
    { dir: 'extensions', area: 'extensions', take: file => (/\.(js|vue)$/.test(file) && (file.includes('/frontend/') || file.endsWith('backend.js') || file.includes('/tools/'))) || file.endsWith('manifest.json') || file.endsWith('index.js') && file.includes('/frontend/') },
]

async function walk(dir) {
    const found = []
    try {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === 'dist') continue
            const full = join(dir, entry.name)
            if (entry.isDirectory()) found.push(...await walk(full))
            else found.push(full)
        }
    } catch { /* 目录不存在 */ }
    return found
}

// .vue 只取 <script> 块（可能有两块：普通 + setup）。
function scriptsOf(code) {
    return [...code.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n')
}

// 相对导入归一到仓库文件；无扩展名时按 TS 习惯补。返回 null 表示系统内置，external 表示包。
function resolveImport(spec, from) {
    if (spec.startsWith('node:')) return null
    if (!spec.startsWith('.')) return { external: spec }
    const base = join(dirname(from), spec)
    const candidates = [base, `${base}.ts`, `${base}.js`, `${base}.vue`, join(base, 'index.ts')]
    for (const one of candidates) {
        const hit = relative(ROOT, one).replaceAll('\\', '/')
        if (FILES.has(hit)) return { file: hit }
    }
    return null
}

const FILES = new Set()
export const nodes = new Map()        // 路径 -> { path, area, exports[], code }
export const edges = []               // { from, to, kind, label? }（to 可以是 external:vue）

// ---------- 一、静态 import ----------
// import type 是编译期类型引用，运行时不存在——画进依赖图是谎言。
// typeOnly 存「from 文件 → import 说明符」：该模块在这个文件里的全部 import 都是 type。
const typeOnly = new Set()

async function scanFile(path, area) {
    const raw = await readFile(join(ROOT, path), 'utf8')
    const code = path.endsWith('.vue') ? scriptsOf(raw) : raw
    nodes.set(path, { path, area, exports: [], code, raw })
    const loader = path.endsWith('.ts') || path.includes('.vue') || path.endsWith('.tsx') ? 'ts' : 'js'
    const info = TRANSPILE[loader].scan(code)
    nodes.get(path).exports = membersOf(code, info.exports.filter(name => name !== 'default'))
    for (const item of TRANSPILE[loader].scanImports(code)) {
        if (item.kind === 'import-statement' || item.kind === 'dynamic-import') {
            const hit = resolveImport(item.path, path)
            if (hit?.file) addEdge(path, hit.file, 'import')
            else if (hit?.external) addEdge(path, `external:${hit.external.split('/')[0] === '@hugeicons' ? '@hugeicons' : hit.external}`, 'import')
        }
    }
    // 同一模块既被值 import 又被 type import 的不算纯类型；只有 type import 的记入 typeOnly。
    const imports = new Map()
    for (const m of code.matchAll(/import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
        const prior = imports.get(m[3]) ?? false
        imports.set(m[3], prior || !m[1])
    }
    for (const [spec, hasValue] of imports) if (!hasValue) typeOnly.add(`${path}→${spec}`)
}

function addEdge(from, to, kind, label) {
    if (from === to) return
    const edge = { from, to, kind, label }
    for (const had of edges) if (had.from === from && had.to === to && had.kind === kind) return void (had.label ||= label)
    edges.push(edge)
}

// ---------- 二、静态分析看不见的边：patch / inject / http / manifest / tool / use ----------
const FEATURE = name => `backend/features/${name}.js`
const RUNTIME = [
    // 扩展后端：ctx 是唯一通道，patch 是“改写”（画），普通调用是数据面（不画）。
    { area: 'extensions', re: /ctx\.patch\(ctx\.(\w+)/g, to: m => FEATURE(m[1]), kind: 'patch', label: m => `patch ${m[1]}` },
    { area: 'extensions', re: /\bctx\.tool\(/g, to: () => FEATURE('Agents'), kind: 'tool', label: () => '登记工具' },
    { area: 'extensions', re: /ctx\.use\(['"](\w+)['"]\)/g, to: m => `extensions/${m[1]}/backend.js`, kind: 'use' },
    // 宿主：server.js 的路由和反向注入。
    { area: 'backend', file: 'backend/server.js', re: /\bAgents\.setup\(/g, to: () => FEATURE('Extension'), kind: 'inject', label: () => '注入 tools()' },
    { area: 'backend', file: 'backend/server.js', re: /\bLoader\.hook\(/g, to: () => FEATURE('Loader'), kind: 'inject', label: () => '注入 targets' },
    { area: 'backend', file: 'backend/server.js', re: /\bawait Agents\.|\bAgents\.open\(/g, to: () => FEATURE('Agents'), kind: 'http' },
    { area: 'backend', file: 'backend/server.js', re: /\bStream\.|await stream\(/g, to: () => FEATURE('Stream'), kind: 'http' },
    { area: 'backend', file: 'backend/server.js', re: /\bExtension\.invoke\(|Loader\.bundle\(|Loader\.(?:entries|inspect)\(/g, to: () => FEATURE('Extension'), kind: 'http' },
    // 前端唯一请求出口打到后端。
    { area: 'web', file: 'web/src/api.ts', re: /\/api\//g, to: () => 'backend/server.js', kind: 'http', label: () => 'REST + SSE' },
    // 扩展前端往组件表/工具视图里登记。
    { area: 'extensions', re: /app\.components\.wrap\(|app\.toolViews\.add\(/g, to: () => 'web/src/Extension.ts', kind: 'patch' },
    { area: 'web', file: 'web/src/demo.ts', re: /Extension\.patch\(API,/g, to: () => 'web/src/api.ts', kind: 'patch' },
    { area: 'web', file: 'web/src/dev-extensions.ts', re: /import\.meta\.glob/g, to: () => 'extensions', kind: 'tool', label: () => '?ext= 源码直载' },
]

// 导出成员清单：Transpiler 只给 export 名；const 对象的导出（如 Agents = { open, send }）抠它的方法名，
// 函数导出（如 export function scan）记函数名。default 不列。常量（全大写）与私有函数不进清单。
// 对象边界用括号配对精确抠（旧版惰性正则会被嵌套闭包骗到，把内部对象的成员也算进来）。
function membersOf(code, names) {
    const list = []
    for (const name of names) {
        const body = sliceObject(code, name)
        if (body) {
            // 只列「方法简写」成员（name(...) {...}）；属性成员（name: 值）不是函数，不进清单——与改造前口径一致。
            // 全是属性简写（如 History = { group }）时按「单个导出名」回退，保持旧口径。
            const methods = topMembers(body).filter(item => item.body)
            if (methods.length) list.push(...methods.map(item => item.name))
            else list.push(name)
        } else if (!KEYWORDS.has(name) && !CONSTANT.test(name)) list.push(name)
    }
    return [...new Set(list)]
}

async function runtimeEdges() {
    for (const rule of RUNTIME) {
        for (const node of nodes.values()) {
            if (node.area !== rule.area) continue
            if (rule.file && node.path !== rule.file) continue
            for (const match of node.code.matchAll(rule.re)) {
                addEdge(node.path, rule.to(match), rule.kind, rule.label?.(match))
            }
        }
    }
    // 扩展清单：requires 是硬边、after 是软边，画进扩展拓扑图。
    for (const node of nodes.values()) {
        if (!node.path.endsWith('manifest.json')) continue
        const manifest = JSON.parse(node.raw)
        const from = node.path.replace('/manifest.json', '/backend.js')
        for (const name of manifest.requires ?? []) addEdge(from, `extensions/${name}/backend.js`, 'manifest', 'requires')
        for (const name of manifest.after ?? []) addEdge(from, `extensions/${name}/backend.js`, 'manifest', 'after')
    }
}

// ---------- 三、规则检查（--check 的数据面）----------
const RULES = [
    {
        name: '循环依赖',
        test() {
            const inner = edges.filter(edge => !edge.to.startsWith('external:'))
            const degree = new Map(), out = new Map()
            for (const edge of inner) {
                out.set(edge.from, [...(out.get(edge.from) ?? []), edge.to])
                degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
                degree.set(edge.from, degree.get(edge.from) ?? 0)
            }
            const ready = [...degree.entries()].filter(([, count]) => count === 0).map(([key]) => key)
            const seen = new Set()
            while (ready.length) {
                const one = ready.pop()
                seen.add(one)
                for (const next of out.get(one) ?? []) {
                    degree.set(next, degree.get(next) - 1)
                    if (degree.get(next) === 0) ready.push(next)
                }
            }
            return [...new Set(inner.flatMap(edge => [edge.from, edge.to]).filter(key => !seen.has(key)))].map(id => `  ✗ 循环依赖涉及：${id}`)
        },
    },
    {
        name: '扩展绕过 ctx 直接 import 宿主',
        test() {
            return edges.filter(edge => edge.kind === 'import' && edge.from.startsWith('extensions/') && edge.to.startsWith('backend/'))
                .map(edge => `  ✗ ${edge.from} 直接 import 了 ${edge.to}（应走 ctx）`)
        },
    },
    {
        name: 'web 组件绕过 Agent 直接 import api',
        test() {
            return edges.filter(edge => edge.kind === 'import' && /\.vue$/.test(edge.from) && edge.to === 'web/src/api.ts')
                .map(edge => `  ✗ ${edge.from} 直接 import 了 api.ts（应经 Agent）`)
        },
    },
    {
        name: 'server.js 被下游引用',
        test() {
            return edges.filter(edge => edge.kind === 'import' && edge.to === 'backend/server.js')
                .map(edge => `  ✗ ${edge.from} import 了入口 server.js`)
        },
    },
    {
        name: 'fetch 出口不唯一（api.ts 之外发请求）',
        test() {
            const offenders = []
            for (const node of nodes.values()) {
                if (node.path === 'web/src/api.ts') continue
                if (node.area === 'web' && /\bfetch\(/.test(node.code)) offenders.push(`  ✗ ${node.path} 里出现了 fetch`)
            }
            return offenders
        },
    },
]

export async function build() {
    // 第一遍：只收集文件名（resolveImport 需要「全量文件表」才能归一相对导入，边不能依赖扫描顺序）。
    for (const scan of SCANS) {
        const dir = join(ROOT, scan.dir.replaceAll('/', '\\'))
        for (const file of await walk(dir)) {
            const path = relative(ROOT, file).replaceAll('\\', '/')
            if (scan.take(path)) FILES.add(path)
        }
    }
    // 第二遍：读代码、扫 import、抠导出。
    for (const scan of SCANS) {
        for (const path of [...FILES]) {
            if (path.endsWith('manifest.json')) continue
            if (scan.take(path)) await scanFile(path, scan.area)
        }
    }
    // manifest：只当数据读，不进 Transpiler（JSON 会炸）。
    for (const path of [...FILES]) {
        if (!path.endsWith('manifest.json')) continue
        const raw = await readFile(join(ROOT, path), 'utf8')
        const area = path.startsWith('extensions/') ? 'extensions' : 'backend'
        nodes.set(path, { path, area, exports: [], code: '', raw })
    }
    await runtimeEdges()
    // 删纯类型 import 边：typeOnly 的 key 就是「文件→说明符」，resolveImport 归一后比对目标。
    for (let i = edges.length - 1; i >= 0; i--) {
        const edge = edges[i]
        if (edge.kind !== 'import') continue
        const raw = nodes.get(edge.from)?.raw ?? ''
        let drop = false
        for (const m of raw.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
            if (!typeOnly.has(`${edge.from}→${m[1]}`)) continue
            const hit = resolveImport(m[1], edge.from)
            if (hit?.file === edge.to || (hit?.external && `external:${hit.external}` === edge.to)) { drop = true; break }
        }
        if (drop) edges.splice(i, 1)
    }
    return { nodes, edges, violations: RULES.flatMap(rule => rule.test()) }
}
