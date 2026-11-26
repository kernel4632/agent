/*
图二的数据面 + 渲染：backend 全链路图。
每条 HTTP 路由一个 subgraph（九组并排，组间零连线），组内是真实的分支结构：
条件分支用菱形节点 + 分支条件标注，错误/拒绝路径用红字，core 回调的扇出如实画。
链路的节点声明在这里，但引用的每个函数必须真实存在于源码扫描结果里——
改名、删函数会让生成直接报错，图不可能悄悄过期。
HTTP 信封（json/fail/read/frame）与运行路径无关，不画（每条路由等价地使用它们）。
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
    'backend/features/Bundle.js': 'fbundle',
    [CORE]: 'fcore',
    'web': 'fweb',
    'web/src/api.ts': 'fweb',
    'web/src/Agent.ts': 'fagents',
    'web/src/Extension.ts': 'fextension',
    'web/src/main.ts': 'fserver',
    'web/src/components/Composer.vue': 'fstream',
    'web/src/components/History.vue': 'fstore',
}

const STYLE = {
    fserver: 'fill:#fff3e0,stroke:#e0a458,color:#8a5a1a',
    fagents: 'fill:#e8f0fe,stroke:#7a9bd4,color:#2c4a7c',
    fstream: 'fill:#e0f2f1,stroke:#6db3a8,color:#1d5c50',
    fmodels: 'fill:#f3e8fe,stroke:#b48ee0,color:#4a2c7c',
    fstore: 'fill:#d8e7fa,stroke:#5a86c4,color:#1d3c6e',
    fextension: 'fill:#f4edfb,stroke:#a98bc4,color:#5b3d80',
    floader: 'fill:#ede7f6,stroke:#9575cd,color:#3e2c63',
    fbundle: 'fill:#fdf0e7,stroke:#d4a76a,color:#6b4a1f',
    fcore: 'fill:#eef1f5,stroke:#9aa7b8,color:#5a6572',
    fweb: 'fill:#e9f7ee,stroke:#7cbf95,color:#2c5c3d',
    froute: 'fill:#e3f2fd,stroke:#64b5f6,color:#0d47a1,font-weight:bold',
    fcheck: 'fill:#fff8e1,stroke:#e0c240,color:#7a6410',
    fbad: 'fill:#fdecea,stroke:#e57373,color:#8f1f1f,font-style:italic',
}

/*
链路表：{ title, nodes: [{ id, label, file, core?, route?, check? }], edges: [{ from, to, label?, core?, bad? }] }。
- route 节点是 HTTP 入口；check 节点画成菱形（条件分支）；bad 边/节点是错误/拒绝路径
- nodes 里不含 web/core 的都要过源码校验；edges 独立声明（不再隐式连主链，分支结构完全显式）
*/

const CHAINS = [
    {
        title: '① POST /send —— 发消息',
        nodes: [
            { id: 'in', label: 'POST /api/agent/:id/send', file: 'backend/server.js', route: true },
            { id: 'send', label: 'Agents.send', file: 'backend/features/Agents.js' },
            { id: 'idle', label: '在运行中？', file: 'backend/features/Agents.js', check: true },
            { id: 'lock', label: '409 正在运行', file: 'backend/features/Agents.js', bad: true },
            { id: 'fault', label: '配置缺失？', file: 'backend/features/Agents.js', check: true },
            { id: 'refuse', label: '400 说明原因', file: 'backend/features/Agents.js', bad: true },
            { id: 'cut', label: '带 cut（改写重发）？', file: 'backend/features/Agents.js', check: true },
            { id: 'docut', label: 'Agents.cut', file: 'backend/features/Agents.js' },
            { id: 'rewrite', label: 'Store.rewriteHistory', file: 'backend/features/Store.js' },
            { id: 'open', label: 'Agents.open', file: 'backend/features/Agents.js' },
            { id: 'read', label: 'Store.config / meta / history', file: 'backend/features/Store.js' },
            { id: 'launch', label: 'launch', file: 'backend/features/Agents.js' },
            { id: 'run', label: 'Stream.emit(run start)', file: 'backend/features/Stream.js' },
            { id: 'core', label: 'agent-core 循环', file: CORE, core: true },
            { id: 'cb', label: 'Agents.callbacks', file: 'backend/features/Agents.js' },
            { id: 'save', label: 'Store.appendHistory（message）', file: 'backend/features/Store.js' },
            { id: 'touch', label: 'Store.touch（step）', file: 'backend/features/Store.js' },
            { id: 'add', label: 'Stream.add', file: 'backend/features/Stream.js' },
            { id: 'sse', label: '浏览器（SSE）', file: 'web' },
        ],
        edges: [
            { from: 'in', to: 'send' },
            { from: 'send', to: 'idle' },
            { from: 'idle', to: 'lock', label: '是', bad: true },
            { from: 'idle', to: 'fault', label: '否' },
            { from: 'fault', to: 'refuse', label: '是', bad: true },
            { from: 'fault', to: 'cut', label: '否' },
            { from: 'cut', to: 'docut', label: '是' },
            { from: 'cut', to: 'open', label: '否' },
            { from: 'docut', to: 'rewrite' },
            { from: 'rewrite', to: 'open' },
            { from: 'open', to: 'read' },
            { from: 'read', to: 'launch' },
            { from: 'launch', to: 'run' },
            { from: 'run', to: 'core' },
            { from: 'core', to: 'cb', core: true },
            { from: 'cb', to: 'save', label: 'message' },
            { from: 'cb', to: 'touch', label: 'step' },
            { from: 'cb', to: 'add', label: '每事件' },
            { from: 'add', to: 'sse' },
        ],
    },
    {
        title: '② GET /stream —— 连接与刷新',
        nodes: [
            { id: 'in', label: 'GET /api/agent/:id/stream', file: 'backend/server.js', route: true },
            { id: 'open', label: 'Agents.open', file: 'backend/features/Agents.js' },
            { id: 'sub', label: 'Stream.subscribe', file: 'backend/features/Stream.js' },
            { id: 'snap', label: 'Agents.snapshot', file: 'backend/features/Agents.js' },
            { id: 'tail', label: 'Stream.tail（合并后的尾巴）', file: 'backend/features/Stream.js' },
            { id: 'retry', label: 'Stream.retryDeadline', file: 'backend/features/Stream.js' },
            { id: 'sse', label: '浏览器（snapshot 首帧）', file: 'web' },
            { id: 'core', label: 'agent-core 事件', file: CORE, core: true },
            { id: 'add', label: 'Stream.add', file: 'backend/features/Stream.js' },
            { id: 'emit', label: 'Stream.emit', file: 'backend/features/Stream.js' },
            { id: 'sse2', label: '浏览器（core 事件）', file: 'web' },
        ],
        edges: [
            { from: 'in', to: 'open' },
            { from: 'open', to: 'sub' },
            { from: 'sub', to: 'snap' },
            { from: 'snap', to: 'tail', label: '含尾巴' },
            { from: 'snap', to: 'retry', label: '含重试' },
            { from: 'tail', to: 'sse' },
            { from: 'retry', to: 'sse' },
            { from: 'core', to: 'add', core: true },
            { from: 'add', to: 'emit' },
            { from: 'emit', to: 'sse2' },
        ],
    },
    {
        title: '③ POST /compact —— 手动压缩',
        nodes: [
            { id: 'in', label: 'POST /api/agent/:id/compact', file: 'backend/server.js', route: true },
            { id: 'compact', label: 'Agents.compact', file: 'backend/features/Agents.js' },
            { id: 'idle', label: '在运行中？', file: 'backend/features/Agents.js', check: true },
            { id: 'lock', label: '409 正在运行', file: 'backend/features/Agents.js', bad: true },
            { id: 'launch', label: 'launch', file: 'backend/features/Agents.js' },
            { id: 'run', label: 'Stream.emit(run start)', file: 'backend/features/Stream.js' },
            { id: 'core', label: 'agent-core（compact 循环）', file: CORE, core: true },
            { id: 'cb', label: 'Agents.callbacks', file: 'backend/features/Agents.js' },
            { id: 'save', label: 'Store.appendHistory（总结消息）', file: 'backend/features/Store.js' },
            { id: 'end', label: 'run end（历史变短）', file: 'web' },
        ],
        edges: [
            { from: 'in', to: 'compact' },
            { from: 'compact', to: 'idle' },
            { from: 'idle', to: 'lock', label: '是', bad: true },
            { from: 'idle', to: 'launch', label: '否' },
            { from: 'launch', to: 'run' },
            { from: 'run', to: 'core' },
            { from: 'core', to: 'cb', core: true },
            { from: 'cb', to: 'save' },
            { from: 'save', to: 'end' },
        ],
    },
    {
        title: '④ POST /stop —— 停止',
        nodes: [
            { id: 'in', label: 'POST /api/agent/:id/stop', file: 'backend/server.js', route: true },
            { id: 'stop', label: 'Agents.stop', file: 'backend/features/Agents.js' },
            { id: 'core', label: 'agent-core（中止信号）', file: CORE, core: true },
            { id: 'wait', label: 'Agents.done（等任务收尾）', file: 'backend/features/Agents.js' },
            { id: 'run', label: 'run stopped', file: 'web' },
        ],
        edges: [
            { from: 'in', to: 'stop' },
            { from: 'stop', to: 'core', core: true },
            { from: 'core', to: 'wait', core: true },
            { from: 'wait', to: 'run' },
        ],
    },
    {
        title: '⑤ POST /configure —— 换模型 / 思考强度',
        nodes: [
            { id: 'in', label: 'POST /api/agent/:id/configure', file: 'backend/server.js', route: true },
            { id: 'configure', label: 'Agents.configure', file: 'backend/features/Agents.js' },
            { id: 'touch', label: 'Store.touch（写 meta）', file: 'backend/features/Store.js' },
            { id: 'resolve', label: 'Models.resolve', file: 'backend/features/Models.js' },
            { id: 'hot', label: '热替换 agent.config', file: 'backend/features/Agents.js', desc: true },
            { id: 'out', label: '返回新 model / effort', file: 'backend/server.js' },
        ],
        edges: [
            { from: 'in', to: 'configure' },
            { from: 'configure', to: 'touch' },
            { from: 'touch', to: 'resolve' },
            { from: 'resolve', to: 'hot' },
            { from: 'hot', to: 'out' },
        ],
    },
    {
        title: '⑥ GET /extensions —— 前端入口列表',
        nodes: [
            { id: 'in', label: 'GET /api/extensions', file: 'backend/server.js', route: true },
            { id: 'entries', label: 'Loader.entries', file: 'backend/features/Loader.js' },
            { id: 'out', label: '已加载扩展的 frontend.js 地址', file: 'web' },
        ],
        edges: [
            { from: 'in', to: 'entries' },
            { from: 'entries', to: 'out' },
        ],
    },
    {
        title: '⑦ GET /extensions/inspect —— 加载状态',
        nodes: [
            { id: 'in', label: 'GET /api/extensions/inspect', file: 'backend/server.js', route: true },
            { id: 'inspect', label: 'Loader.inspect', file: 'backend/features/Loader.js' },
            { id: 'chain', label: 'Extension.inspect（patch 链 / 动作表）', file: 'backend/features/Extension.js' },
            { id: 'out', label: '加载状态 + 冲突可见', file: 'web' },
        ],
        edges: [
            { from: 'in', to: 'inspect' },
            { from: 'inspect', to: 'chain' },
            { from: 'chain', to: 'out' },
        ],
    },
    {
        title: '⑧ GET /extensions/:name/frontend.js —— 扩展前端',
        nodes: [
            { id: 'in', label: 'GET /api/extensions/:name/frontend.js', file: 'backend/server.js', route: true },
            { id: 'frontend', label: 'frontend()', file: 'backend/server.js' },
            { id: 'bundle', label: 'Loader.bundle', file: 'backend/features/Loader.js' },
            { id: 'pack', label: 'Bundle.pack（mtime 缓存，改 .vue 重打）', file: 'backend/features/Bundle.js' },
            { id: 'out', label: 'ESM 前端包（vue 外部化）', file: 'web' },
        ],
        edges: [
            { from: 'in', to: 'frontend' },
            { from: 'frontend', to: 'bundle' },
            { from: 'bundle', to: 'pack' },
            { from: 'pack', to: 'out' },
        ],
    },
    {
        title: 'W① 发送 —— 用户敲字之后',
        nodes: [
            { id: 'user', label: '用户输入 / 回车', file: 'web' },
            { id: 'submit', label: 'Composer.submit', file: 'web/src/components/Composer.vue' },
            { id: 'running', label: 'running 中？', file: 'web/src/components/Composer.vue', check: true },
            { id: 'stopbtn', label: '变「停止」钮（不动）', file: 'web', desc: true },
            { id: 'action', label: 'action 是哪种？', file: 'web/src/components/Composer.vue', check: true },
            { id: 'stop', label: 'Agent.stop', file: 'web/src/Agent.ts' },
            { id: 'cont', label: 'Agent.continue', file: 'web/src/Agent.ts' },
            { id: 'pack', label: 'pack（文本 + 附件）', file: 'web/src/Agent.ts', desc: true },
            { id: 'send', label: 'api.send（POST /send）', file: 'web/src/api.ts' },
            { id: 'fault', label: '网络/409 → state.fault', file: 'web/src/Agent.ts', bad: true },
        ],
        edges: [
            { from: 'user', to: 'submit' },
            { from: 'submit', to: 'running' },
            { from: 'running', to: 'stopbtn', label: '是', bad: true },
            { from: 'running', to: 'action', label: '否' },
            { from: 'action', to: 'stop', label: 'stop' },
            { from: 'action', to: 'cont', label: 'continue' },
            { from: 'action', to: 'pack', label: 'send' },
            { from: 'pack', to: 'send' },
            { from: 'send', to: 'fault', label: '失败', bad: true },
        ],
    },
    {
        title: 'W② SSE 帧 → 状态 → 界面（核心链路）',
        nodes: [
            { id: 'sse', label: 'api.connect 收到 SSE 帧', file: 'web/src/api.ts' },
            { id: 'which', label: '帧类型？', file: 'web/src/api.ts', check: true },
            { id: 'apply', label: 'Agent.apply（snapshot：整份历史 + 尾巴重放）', file: 'web/src/Agent.ts' },
            { id: 'receive', label: 'Agent.receive（core 事件分发）', file: 'web/src/Agent.ts' },
            { id: 'msg', label: 'message → history.push（消息出现）', file: 'web/src/Agent.ts', desc: true },
            { id: 'live', label: 'request-start → live 请求条出现', file: 'web/src/Agent.ts', desc: true },
            { id: 'parts', label: 'text/reasoning/tool-* → live.parts 增量', file: 'web/src/Agent.ts', desc: true },
            { id: 'retry', label: 'request-error → retry 倒计时', file: 'web/src/Agent.ts', desc: true },
            { id: 'state', label: 'Agent.state（唯一真相源，响应式）', file: 'web/src/Agent.ts', core: true, desc: true },
            { id: 'group', label: 'History.group（纯函数：历史 → 显示条目）', file: 'web/src/components/History.vue', desc: true },
            { id: 'dispatch', label: 'History.vue 按 kind 分发', file: 'web/src/components/History.vue' },
            { id: 'view', label: '按 kind 分发<br/>UserMessage · Process · AssistantMessage · ErrorMessage<br/>「继续」钮 → Agent.continue', file: 'web' },
        ],
        edges: [
            { from: 'sse', to: 'which' },
            { from: 'which', to: 'apply', label: 'snapshot' },
            { from: 'which', to: 'receive', label: 'core' },
            { from: 'apply', to: 'state' },
            { from: 'receive', to: 'msg' },
            { from: 'receive', to: 'live' },
            { from: 'receive', to: 'parts' },
            { from: 'receive', to: 'retry' },
            { from: 'msg', to: 'state' },
            { from: 'live', to: 'state' },
            { from: 'parts', to: 'state' },
            { from: 'retry', to: 'state' },
            { from: 'state', to: 'group', core: true },
            { from: 'group', to: 'dispatch' },
            { from: 'dispatch', to: 'view' },
        ],
    },
    {
        title: 'W③ 连接生命周期',
        nodes: [
            { id: 'main', label: 'main.ts（装配）', file: 'web/src/main.ts', desc: true },
            { id: 'shell', label: 'shell 扩展接管路由', file: 'web', desc: true },
            { id: 'connect', label: 'Agent.connect(id)', file: 'web/src/Agent.ts' },
            { id: 'api', label: 'api.connect（GET SSE）', file: 'web/src/api.ts' },
            { id: 'down', label: '连接断开？', file: 'web/src/api.ts', check: true },
            { id: 'wait', label: '1 秒后重连', file: 'web/src/api.ts', desc: true },
            { id: 'resnap', label: '重新 snapshot（历史重放 + 尾巴补帧，不丢不重）', file: 'web/src/Agent.ts', desc: true },
        ],
        edges: [
            { from: 'main', to: 'shell' },
            { from: 'shell', to: 'connect' },
            { from: 'connect', to: 'api' },
            { from: 'api', to: 'down' },
            { from: 'down', to: 'wait', label: '是' },
            { from: 'wait', to: 'resnap' },
            { from: 'resnap', to: 'api', label: '重连' },
        ],
    },
]

/*
校验：链路里声明的每个函数节点都要能在源码扫描里找到。
nameOf 从 label 提取「最后一个 . 或空格 前的函数名」；描述性节点（如 409）跳过。
*/

// 'Store.appendHistory（message）' → 'appendHistory'；'wire()' → 'wire'；'在运行中？' → ''（跳过）
function nameOf(step) {
    const text = step.label.split('（')[0].split('（')[0].split('?')[0].replace(/\(.*$/, '').trim()
    const hit = text.match(/(?:\.|^)\s*([A-Za-z_$][\w$]*)\s*$/)
    return hit ? hit[1] : ''
}

async function scanExports() {
    const found = new Map()        // path -> Set(公开成员 + 顶层函数名)
    const files = [
        'backend/server.js', 'backend/features/Agents.js', 'backend/features/Stream.js',
        'backend/features/Models.js', 'backend/features/Store.js', 'backend/features/Extension.js',
        'backend/features/Loader.js', 'backend/features/Bundle.js',
        'web/src/api.ts', 'web/src/Agent.ts', 'web/src/Extension.ts', 'web/src/main.ts',
        'web/src/components/Composer.vue', 'web/src/components/History.vue',
    ]
    for (const path of files) {
        const raw = await Bun.file(path).text()
        // .vue 只取 <script> 块（HTML 注释会炸 Transpiler）
        const code = path.endsWith('.vue') ? [...raw.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n') : raw
        const isTs = path.endsWith('.ts') || path.endsWith('.vue')
        const info = new Bun.Transpiler({ loader: isTs ? 'ts' : 'js' }).scan(code)
        const names = new Set(info.exports.filter(name => name !== 'default'))
        // const 对象的成员也是公开面（Agents.open、api.send 等）：
        // 方法简写 name(...) {...} 与属性箭头 name: (...) => {...} 两种形式都抓。
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
                const body = rest.slice(0, i)
                for (const m of body.matchAll(/(?:^|\n)\s*(?:async\s+)?(\w+)\s*\(/g)) names.add(m[1])      // 方法简写 name(...)
                for (const m of body.matchAll(/(?:^|\n)\s*(?:async\s+)?(\w+)\s*:\s*(?:async\s*)?[\w(]/g)) names.add(m[1])  // 属性箭头 name: x => / name: async
            }
        }
        // 顶层函数声明（含私有，如 launch/sort/weave、前端组件 <script setup> 里的 submit）也是链路节点
        for (const m of code.matchAll(/(?:^|\n)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
            if (!KEYWORDS.has(m[1])) names.add(m[1])
        }
        // .vue 的 <script setup> 里定义的函数（function submit / async function load 等）也是节点
        if (path.endsWith('.vue')) {
            const setup = [...code.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
            for (const m of setup.matchAll(/(?:^|\n)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
                if (!KEYWORDS.has(m[1])) names.add(m[1])
            }
        }
        found.set(path, names)
    }
    return found
}

function validate(chains, exports) {
    const problems = []
    for (const chain of chains) {
        for (const step of chain.nodes) {
            if (step.file === 'web' || step.file === CORE) continue        // 浏览器和 core 是端点，不校验
            if (step.desc || step.check || step.bad || step.route) continue // 描述 / 分支问句 / 错误终点 / HTTP 地址
            const name = nameOf(step)
            if (!name) continue                                           // 路由地址等
            if (!exports.has(step.file)) { problems.push(`文件不存在：${step.file}（${step.label}）`); continue }
            if (!exports.get(step.file).has(name)) problems.push(`${step.file} 里没有 ${name}（${step.label}）——链路声明过期了`)
        }
    }
    return problems
}

// 标签整形：mermaid 节点宽度约 12 全角字符一行（中文 1、英文 0.5），超长截断。
// 「主名（说明）」拆成两行；长行按显示宽度在空格 / 斜杠处软折。
function foldLabel(label) {
    const width = text => [...text].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0xff ? 1 : 0.5), 0)
    const m = label.match(/^(.{2,16})（(.*)）$/)
    if (m) return `${m[1]}<br/>${m[2]}`
    if (width(label) <= 12) return label
    const parts = []
    let line = ''
    for (const ch of label) {
        line += ch
        if (width(line) >= 11 && /[ /·]/.test(ch)) { parts.push(line.trim()); line = '' }
    }
    if (line.trim()) parts.push(line.trim())
    return parts.join('<br/>')
}

// 渲染：graph LR，一条路由一个 subgraph（九组并排，组间零连线）。
// 分支节点画菱形（check），错误路径红字斜体（bad），core 用粗线。
// filter 为空画全部链路；传 'backend' 只画 backend 九条，'web' 只画 web 三条。
export async function renderChains(filter = '') {
    const exports = await scanExports()
    const picked = CHAINS.filter(chain => !filter ? true : filter === 'backend' ? !chain.title.startsWith('W') : chain.title.startsWith('W'))
    const problems = validate(picked, exports)
    if (problems.length) throw new Error(`链路声明与代码不符：\n${problems.join('\n')}\n请更新 tools/flow.js 里的链路表`)
    const lines = ['graph LR']
    for (const [index, chain] of picked.entries()) {
        const tag = `c${index}`
        lines.push(`    subgraph ${tag}["${chain.title}"]`)
        for (const step of chain.nodes) {
            const style = step.route ? 'froute' : step.check ? 'fcheck' : step.bad ? 'fbad' : FILE_STYLE[step.file] ?? 'fcore'
            const shape = step.check ? `{"${step.label}"}` : `["${foldLabel(step.label)}"]`
            lines.push(`        ${tag}_${step.id}${shape}:::${style}`)
        }
        lines.push('    end')
    }
    for (const [index, chain] of picked.entries()) {
        const tag = `c${index}`
        for (const edge of chain.edges) {
            const label = (edge.label ?? '').replace(/[|=.]/g, '').trim()
            const text = edge.bad && label ? `${label} ✗` : label
            if (edge.core) lines.push(`    ${tag}_${edge.from} ${text ? `== ${text} ==>` : '==>'} ${tag}_${edge.to}`)
            else lines.push(`    ${tag}_${edge.from} ${text ? `-- ${text} -->` : '-->'} ${tag}_${edge.to}`)
        }
    }
    for (const [name, style] of Object.entries(STYLE)) lines.push(`    classDef ${name} ${style}`)
    return lines.join('\n')
}
