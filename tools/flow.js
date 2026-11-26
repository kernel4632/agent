/*
图二的数据面 + 渲染：backend 链路图。
subgraph 不是文件而是「一条链路」（发消息 / 连接与刷新 / 扩展加载 / 动作调用），组间零连线，并排展示。
节点按文件着色（八色），一眼看出执行顺序和文件归属。
链路的步骤序列在这里声明，但引用的每个函数必须真实存在于对源码的扫描结果里——
改名、删函数会让生成直接报错，图不可能悄悄过期。
*/

import { KEYWORDS } from './slice.js'

const TRANSPILE = new Bun.Transpiler({ loader: 'js' })
const CORE = '@kernel4632/agent-core'

// 链路里出现的文件 → 颜色 class；色板沿文件级图的分区色。
const FILE_STYLE = {
    'backend/server.js': 'fserver',
    'backend/features/Agents.js': 'fagents',
    'backend/features/Stream.js': 'fstream',
    'backend/features/Models.js': 'fmodels',
    'backend/features/Store.js': 'fstore',
    'backend/features/Extension.js': 'fextension',
    'backend/features/Loader.js': 'floader',
    [CORE]: 'fcore',
    'web': 'fweb',
}

const STYLE = {
    fserver: 'fill:#fff3e0,stroke:#e0a458,color:#8a5a1a',
    fagents: 'fill:#e8f0fe,stroke:#7a9bd4,color:#2c4a7c',
    fstream: 'fill:#e0f2f1,stroke:#6db3a8,color:#1d5c50',
    fmodels: 'fill:#f3e8fe,stroke:#b48ee0,color:#4a2c7c',
    fstore: 'fill:#d8e7fa,stroke:#5a86c4,color:#1d3c6e',
    fextension: 'fill:#f4edfb,stroke:#a98bc4,color:#5b3d80',
    floader: 'fill:#ede7f6,stroke:#9575cd,color:#3e2c63',
    fcore: 'fill:#eef1f5,stroke:#9aa7b8,color:#5a6572',
    fweb: 'fill:#e9f7ee,stroke:#7cbf95,color:#2c5c3d',
    froute: 'fill:#e3f2fd,stroke:#64b5f6,color:#0d47a1,font-weight:bold',
}

/*
链路表：每条 { title, steps: [{ id, label, file, core? }] }。
steps 顺次相连成主链；分叉用 extra: [{ from, to }]（from/to 是步骤 id）。
core 边用粗线（交给 agent-core 的循环）；「回调」语义也用粗线表达。
*/

const CHAINS = [
    {
        title: '① 发消息',
        steps: [
            { id: 'in', label: 'POST /api/agent/:id/send', file: 'backend/server.js' },
            { id: 'send', label: 'Agents.send', file: 'backend/features/Agents.js' },
            { id: 'idle', label: 'idle（409 锁）', file: 'backend/features/Agents.js' },
            { id: 'open', label: 'Agents.open', file: 'backend/features/Agents.js' },
            { id: 'launch', label: 'launch', file: 'backend/features/Agents.js' },
            { id: 'run', label: 'Stream.emit(run)', file: 'backend/features/Stream.js' },
            { id: 'core', label: 'agent-core 循环', file: CORE, core: true },
            { id: 'cb', label: 'Agents.callbacks', file: 'backend/features/Agents.js' },
            { id: 'save', label: 'Store.appendHistory', file: 'backend/features/Store.js' },
            { id: 'add', label: 'Stream.add', file: 'backend/features/Stream.js' },
            { id: 'sse', label: '浏览器（SSE）', file: 'web' },
        ],
    },
    {
        title: '② 连接与刷新',
        steps: [
            { id: 'in', label: 'GET /api/agent/:id/stream', file: 'backend/server.js' },
            { id: 'open', label: 'Agents.open', file: 'backend/features/Agents.js' },
            { id: 'sub', label: 'Stream.subscribe', file: 'backend/features/Stream.js' },
            { id: 'snap', label: 'Agents.snapshot', file: 'backend/features/Agents.js' },
            { id: 'sse', label: '浏览器（snapshot 首帧）', file: 'web' },
        ],
        floating: [
            { id: 'core', label: 'agent-core 事件', file: CORE, core: true },
            { id: 'add', label: 'Stream.add', file: 'backend/features/Stream.js' },
            { id: 'emit', label: 'Stream.emit', file: 'backend/features/Stream.js' },
            { id: 'sse2', label: '浏览器（core 事件）', file: 'web' },
        ],
        extra: [
            { from: 'core', to: 'add' },
            { from: 'add', to: 'emit' },
            { from: 'emit', to: 'sse2' },
        ],
    },
    {
        title: '③ 扩展加载',
        steps: [
            { id: 'wire', label: 'wire()', file: 'backend/server.js' },
            { id: 'hook', label: 'Loader.hook', file: 'backend/features/Loader.js' },
            { id: 'start', label: 'Loader.start', file: 'backend/features/Loader.js' },
            { id: 'scan', label: 'scan（扫描目录）', file: 'backend/features/Loader.js' },
            { id: 'sort', label: 'sort（拓扑排序）', file: 'backend/features/Loader.js' },
            { id: 'weave', label: 'weave（执行 backend.js）', file: 'backend/features/Loader.js' },
            { id: 'scope', label: 'Extension.scope（ctx）', file: 'backend/features/Extension.js' },
        ],
    },
    {
        title: '④ 动作调用',
        steps: [
            { id: 'in', label: 'POST /api/op/:name', file: 'backend/server.js' },
            { id: 'invoke', label: 'Extension.invoke', file: 'backend/features/Extension.js' },
            { id: 'handler', label: '扩展 handler', file: 'backend/features/Extension.js' },
            { id: 'store', label: 'Store.config', file: 'backend/features/Store.js' },
            { id: 'out', label: 'json 响应', file: 'backend/server.js' },
        ],
    },
]

/*
校验：链路里声明的每个函数节点都要能在源码扫描结果里找到同名公开成员。
node 名取 label 里的「最后一个 . 或空格 前的函数名」；文件必须存在。
找不到就抛错——图不可能悄悄过期。
*/

// 从 label 提取被校验的函数名：'Store.appendHistory' → 'appendHistory'；'wire()' → 'wire'。
function nameOf(step) {
    const text = step.label.split('（')[0].replace(/\(\)$/, '').trim()
    const hit = text.match(/(?:\.|^)\s*([A-Za-z_$][\w$]*)$/)
    return hit ? hit[1] : ''
}

async function scanExports() {
    const found = new Map()        // path -> Set(公开成员名)
    const files = [
        'backend/server.js', 'backend/features/Agents.js', 'backend/features/Stream.js',
        'backend/features/Models.js', 'backend/features/Store.js', 'backend/features/Extension.js',
        'backend/features/Loader.js', 'backend/features/Bundle.js',
    ]
    for (const path of files) {
        const code = await Bun.file(path).text()
        const info = TRANSPILE.scan(code)
        const names = new Set(info.exports.filter(name => name !== 'default'))
        // const 对象的成员也是公开面（Agents.open 等）
        for (const name of names) {
            const hit = code.match(new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*\\{`))
            if (hit) {
                const rest = code.slice(hit.index + hit[0].length)
                let depth = 1, i = 0
                while (i < rest.length && depth > 0) {
                if (rest[i] === '{') depth++
                else if (rest[i] === '}') depth--
                i++
                }
                for (const m of rest.slice(0, i).matchAll(/(?:^|\n)\s*(?:async\s+)?(\w+)\s*\(/g)) {
                    if (!KEYWORDS.has(m[1])) names.add(m[1])
                }
            }
        }
        // 顶层函数声明（含私有，如 launch/sort/weave）也是链路可能经过的执行节点
        for (const m of code.matchAll(/(?:^|\n)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
            if (!KEYWORDS.has(m[1])) names.add(m[1])
        }
        found.set(path, names)
    }
    return found
}

function validate(chains, exports) {
    const problems = []
    for (const chain of chains) {
        for (const step of [...chain.steps, ...(chain.floating ?? [])]) {
            if (step.file === 'web' || step.file === CORE) continue        // 浏览器和 core 是端点，不校验
            const name = nameOf(step)
            if (!name) continue                                           // 路由等描述性节点
            if (!exports.has(step.file)) { problems.push(`文件不存在：${step.file}（${step.label}）`); continue }
            if (!exports.get(step.file).has(name)) problems.push(`${step.file} 里没有 ${name}（${step.label}）——链路声明过期了`)
        }
    }
    return problems
}

// 渲染：graph LR，一条链一个 subgraph（组间零连线，并排展示），主链顺次相连，extra 是分叉，core 粗线。
export async function renderChains() {
    const exports = await scanExports()
    const problems = validate(CHAINS, exports)
    if (problems.length) throw new Error(`链路声明与代码不符：\n${problems.join('\n')}\n请更新 tools/flow.js 里的链路表`)
    const lines = ['graph LR']
    for (const [index, chain] of CHAINS.entries()) {
        const tag = `c${index}`
        lines.push(`    subgraph ${tag}["${chain.title}"]`)
        for (const step of [...chain.steps, ...(chain.floating ?? [])]) {
            const style = /^(POST|GET) /.test(step.label) ? 'froute' : FILE_STYLE[step.file] ?? 'fcore'
            lines.push(`        ${tag}_${step.id}["${step.label}"]:::${style}`)
        }
        lines.push('    end')
    }
    for (const [index, chain] of CHAINS.entries()) {
        const tag = `c${index}`
        const stepOf = id => chain.steps.find(step => step.id === id) ?? (chain.floating ?? []).find(step => step.id === id)
        const link = (from, to, isCore, label) => {
            const arrow = isCore ? (label ? `== ${label} ==>` : '==>') : '-->'
            lines.push(`    ${tag}_${from} ${arrow} ${tag}_${to}`)
        }
        for (let i = 1; i < chain.steps.length; i++) link(chain.steps[i - 1].id, chain.steps[i].id, Boolean(chain.steps[i - 1].core))
        const drawn = new Set()
        for (let i = 1; i < chain.steps.length; i++) drawn.add(`${chain.steps[i - 1].id}>${chain.steps[i].id}`)
        for (const edge of chain.extra ?? []) {
            const from = stepOf(edge.from)
            if (from && stepOf(edge.to) && !drawn.has(`${edge.from}>${edge.to}`)) {
                drawn.add(`${edge.from}>${edge.to}`)
                link(edge.from, edge.to, Boolean(from.core), edge.label)
            }
        }
    }
    for (const [name, style] of Object.entries(STYLE)) lines.push(`    classDef ${name} ${style}`)
    return lines.join('\n')
}
