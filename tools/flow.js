/*
图二的数据面 + 渲染：backend 函数级流程图。
文件是 subgraph 分组框，函数是节点：路由 / 导出函数 / 文件内辅助函数（非导出、被流程调用，斜体淡色）。
边来自运行时调用点：跨模块 Name.method(、文件内裸 helper(、交给 agent-core 的 agent.method(。
静态 import 边不画——backend 同层不互相 import 是铁律，跨文件调用全部发生在运行时，这张图就是它的写照。
agent-core 内部不可见，作为整体节点（粗线）。
*/

import { matchBrace, matchParen, sliceObject, splitTop, topMembers, maskLiterals, KEYWORDS } from './slice.js'

const TRANSPILE = new Bun.Transpiler({ loader: 'js' })
const CORE = '@kernel4632/agent-core'
const ORDER = [
    'backend/server.js', 'backend/features/Agents.js', 'backend/features/Stream.js', 'backend/features/Models.js',
    'backend/features/Store.js', 'backend/features/Extension.js', 'backend/features/Loader.js', 'backend/features/Bundle.js',
]

const FLOW_STYLE = {
    fbackend: 'fill:#e8f0fe,stroke:#7a9bd4,color:#2c4a7c',
    store: 'fill:#d8e7fa,stroke:#5a86c4,color:#1d3c6e',
    fhelper: 'fill:#f4f6f9,stroke:#c3ccd8,color:#8593a6,font-style:italic',
    froute: 'fill:#fff3e0,stroke:#e0a458,color:#8a5a1a',
    fcore: 'fill:#eef1f5,stroke:#9aa7b8,color:#5a6572',
}

// 相对导入归一成仓库路径（backend 内部的 import 都带 .js 扩展名）。
function resolveSpec(from, spec) {
    const out = []
    for (const part of [...from.split('/').slice(0, -1), ...spec.split('/')]) {
        if (!part || part === '.') continue
        if (part === '..') out.pop()
        else out.push(part)
    }
    return out.join('/')
}

// server.js 路由表：每条路由一个函数节点。键是字符串，要从原文读（掩码会把引号抠掉）。
// 返回 { routes, restMask }：restMask 是 create 函数体去掉路由表后的掩码（路由体里的调用归路由节点，不归 create）。
function routesOf(code, mask) {
    const at = mask.indexOf('routes: {')
    if (at === -1) return { routes: [], restMask: mask }
    const open = mask.indexOf('{', at)
    const close = matchBrace(mask, open)
    const body = mask.slice(open + 1, close)
    const routes = []
    let count = 0
    for (const seg of splitTop(body)) {
        const part = body.slice(seg.start, seg.end)
        const colon = part.indexOf(':')
        const key = /'([^']+)'/.exec(code.slice(open + 1 + seg.start, open + 1 + seg.start + colon))?.[1]
        if (!key) continue
        const value = part.slice(colon + 1)
        routes.push({ name: (/^\s*\{\s*POST:/.test(value) ? 'POST ' : 'GET ') + key, kind: 'route', body: maskLiterals(value), id: `0_r${count++}` })
    }
    return { routes, restMask: mask.slice(0, open + 1) + mask.slice(close) }
}

// 一个 backend 文件的函数表：导出对象成员、export function、文件内 helper、路由。
function fileOf(nodes, path, index) {
    const node = nodes.get(path)
    if (!node) return null
    const code = node.code
    const mask = maskLiterals(code)
    const imports = new Map()
    for (const hit of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
        for (const raw of hit[1].split(',')) {
            const name = raw.trim().split(/\s+as\s+/).pop().trim()
            if (name) imports.set(name, hit[2].startsWith('.') ? resolveSpec(path, hit[2]) : hit[2] === CORE ? CORE : null)
        }
    }
    const objectName = TRANSPILE.scan(code).exports.filter(name => name !== 'default').find(name => sliceObject(code, name)) ?? null
    const members = objectName ? topMembers(sliceObject(code, objectName)).map(({ name, body }) => ({ name, body, kind: 'member' })) : []
    // server.js 路由表：路由体里的调用归路由节点；create 的扫描体去掉路由区。
    const routes = path === 'backend/server.js' ? routesOf(code, mask) : { routes: [], restMask: mask }
    const fns = [], helpers = []
    for (const decl of mask.matchAll(/(?:^|\n)(export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g)) {
        const open = mask.indexOf('(', decl.index + decl[0].length - 1)
        const brace = mask.indexOf('{', matchParen(mask, open))
        const end = matchBrace(mask, brace)
        let body = mask.slice(brace + 1, end)
        if (path === 'backend/server.js' && decl[2] === 'create') {
            const at = body.indexOf('routes: {')
            if (at >= 0) body = body.slice(0, at)
        }
        const fn = { name: decl[2], kind: decl[1] ? 'fn' : 'helper', body: maskLiterals(body) }
        ;(decl[1] ? fns : helpers).push(fn)
    }
    // 属性简写成员（如 Store.home,）与同名 helper 是同一个函数：并成公开节点；不同体的同名（Loader.scan）加撇号。
    for (const member of members) {
        const at = helpers.findIndex(fn => fn.name === member.name)
        if (at >= 0 && !member.body) { member.body = helpers[at].body; helpers.splice(at, 1) }
    }
    for (const helper of helpers) if (members.some(member => member.name === helper.name)) helper.alias = true
    const fnsAll = [...fns, ...members, ...helpers, ...routes.routes]
    fnsAll.forEach(fn => { fn.id ??= `${index}_${fn.name}${fn.alias ? 'h' : ''}` })
    // 裸调用解析表：helper 覆盖同名成员（词法绑定指向顶层函数声明）。
    const bare = new Map()
    for (const fn of [...fns, ...members]) bare.set(fn.name, fn)
    for (const fn of helpers) bare.set(fn.name, fn)
    return { path, index, objectName, imports, fns: fnsAll, bare, public: new Map([...fns, ...members].map(fn => [fn.name, fn])) }
}

// 跨模块调用的目标：自己（objectName）、import 映射的文件、或 agent-core。
function moduleTarget(file, files, mod, method) {
    let targetFile = null
    if (mod === file.objectName) targetFile = file
    else {
        const spec = file.imports.get(mod)
        if (spec === CORE) return { core: true }
        if (!spec || !files.has(spec)) return null
        targetFile = files.get(spec)
    }
    const fn = targetFile.public.get(method)
    return fn ? { fn } : null
}

function callEdges(file, files, edges, seen) {
    const add = (from, to, label) => {
        const key = `${from}>${to}>${label ?? ''}`
        if (from === to || seen.has(key)) return
        seen.add(key)
        edges.push({ from, to, label })
    }
    for (const fn of file.fns) {
        for (const hit of fn.body.matchAll(/\b([A-Z]\w*)\.(\w+)\s*\(/g)) {
            const target = moduleTarget(file, files, hit[1], hit[2])
            if (target?.core) add(fn.id, 'core', hit[2])
            else if (target?.fn) add(fn.id, target.fn.id)
        }
        for (const hit of fn.body.matchAll(/\bagent\.(\w+)\s*\(/g)) add(fn.id, 'core', hit[1])
        for (const hit of fn.body.matchAll(/(?<![\w.$])([a-z]\w*)\s*\(/g)) {
            if (KEYWORDS.has(hit[1])) continue
            const target = file.bare.get(hit[1])
            if (target) add(fn.id, target.id)
        }
    }
}

// 数据面：backend 八个文件的函数节点 + 运行时调用边。helper 只画被公开函数（含 helper→helper 传递）够到的。
export function buildFlow(nodes) {
    const files = ORDER.map((path, index) => fileOf(nodes, path, index)).filter(Boolean)
    const byPath = new Map(files.map(file => [file.path, file]))
    const edges = []
    const seen = new Set()
    for (const file of files) callEdges(file, byPath, edges, seen)
    const helperIds = new Set(files.flatMap(file => file.fns.filter(fn => fn.kind === 'helper')).map(fn => fn.id))
    const keep = new Set(files.flatMap(file => file.fns.filter(fn => fn.kind !== 'helper')).map(fn => fn.id))
    for (let growing = true; growing;) {
        growing = false
        for (const edge of edges) if (keep.has(edge.from) && helperIds.has(edge.to) && !keep.has(edge.to)) { keep.add(edge.to); growing = true }
    }
    for (const file of files) file.fns = file.fns.filter(fn => fn.kind !== 'helper' || keep.has(fn.id))
    return { files, edges: edges.filter(edge => keep.has(edge.from) && (edge.to === 'core' || keep.has(edge.to))) }
}

// 渲染：subgraph=文件、节点=函数、实线=运行时调用、粗线=交给 core。
export function renderFlow(flow) {
    const lines = ['graph TD']
    const classOf = (file, fn) => fn.kind === 'route' ? 'froute' : fn.kind === 'helper' ? 'fhelper' : file.path.endsWith('Store.js') ? 'store' : 'fbackend'
    for (const file of flow.files) {
        lines.push(`    subgraph s${file.index}["${file.path}"]`)
        for (const fn of file.fns) {
            const label = fn.kind === 'route' ? fn.name : `${fn.name}${fn.alias ? '′' : ''}()`
            lines.push(`        ${fn.id}["${label}"]:::${classOf(file, fn)}`)
        }
        lines.push('    end')
    }
    lines.push('    core["<b>agent-core</b>（唯一循环，内部不可见）"]:::fcore')
    for (const edge of flow.edges) {
        const label = (edge.label ?? '').replace(/[|=.()]/g, '').trim()
        lines.push(edge.to === 'core' ? `    ${edge.from} == ${label} ==> core` : `    ${edge.from} --> ${edge.to}`)
    }
    for (const [name, style] of Object.entries(FLOW_STYLE)) lines.push(`    classDef ${name} ${style}`)
    return lines.join('\n')
}
