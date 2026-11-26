/*
架构图扫描器 + 生成器：bun tools/architecture.js [--check]
- 扫描 backend / web/src / extensions 的 import、patch、注入、HTTP、扩展清单，产出统一的数据面
- 生成 docs/architecture.md：宏观 / backend / web / extensions 四张 mermaid 图（节点内嵌导出函数清单）
- --check：把 AGENTS.md 的架构规矩写成机器规则（循环依赖、扩展绕 ctx、组件绕 Agent、fetch 出口唯一、入口不被引用），违规则红
数据面在 graph.js；改了架构跑一次重新生成，图不会过期。
*/

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build, KIND_COLOR } from './graph.js'
import { renderChains } from './flow.js'

// ---------- 数据面 ----------
const { nodes, edges, violations } = await build()
const back = await renderChains()

// 节点显示名：去掉前缀目录，保留区分度需要的部分。
function label(path) {
    const short = path.replace(/^backend\/(features\/)?/, '').replace(/^web\/src\/(components\/)?/, '').replace(/^extensions\//, '').replace(/\/(backend|frontend)\/index\.(js|vue|ts)$/, '').replace(/\.(js|ts|vue)$/, '')
    return short || path
}

// 节点内嵌的函数清单：导出非 default 的名字，最多 8 个，按显示宽度折行
// （GitHub 实测节点约 6-7 全角字符宽；中文计 1、英文数字计 0.5）。
function member(path) {
    const names = nodes.get(path)?.exports ?? []
    if (!names.length) return ''
    const shown = names.slice(0, 8).map(name => `${name}()`)
    if (names.length > 8) shown.push(`+${names.length - 8}`)
    const width = text => [...text].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0xff ? 1 : 0.5), 0)
    const rows = []
    let line = ''
    for (const one of shown) {
        if (line && width(line + ' ' + one) > 11) { rows.push(line); line = one }
        else line = line ? `${line} ${one}` : one
    }
    if (line) rows.push(line)
    return rows.join('<br/>')
}

function nodeId(path) {
    return 'n' + [...path].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7).toString(36)
}

const AREA_STYLE = {
    'agent-core': 'fill:#eef1f5,stroke:#9aa7b8,color:#5a6572',
    backend: 'fill:#e8f0fe,stroke:#7a9bd4,color:#2c4a7c',
    store: 'fill:#d8e7fa,stroke:#5a86c4,color:#1d3c6e',
    web: 'fill:#e9f7ee,stroke:#7cbf95,color:#2c5c3d',
    webui: 'fill:#f2fbf5,stroke:#a5d4b8,color:#2c5c3d',
    ext: 'fill:#f4edfb,stroke:#a98bc4,color:#5b3d80',
    route: 'fill:#fff3e0,stroke:#e0a458,color:#8a5a1a',
}

function areaOf(path) {
    if (path === 'external:@kernel4632/agent-core') return 'agent-core'
    if (path.startsWith('external:')) return 'route'
    if (path.endsWith('Store.js')) return 'store'
    if (path.startsWith('backend/')) return 'backend'
    if (path.startsWith('web/src/components/') || path.endsWith('.vue')) return 'webui'
    if (path.startsWith('web/')) return 'web'
    if (path.startsWith('extensions/')) return 'ext'
    return 'route'
}

// ---------- 通用渲染 ----------
// 边只使用 mermaid 文档保证的形式：实线 -->；粗线带字 == text ==>；虚线带字 -. text .->。
// （GitHub 的渲染器不接受「箭头 |标签|」的写法，实测 Parse error got 'PS'。）
function edgeLine(edge) {
    const from = nodeId(edge.from), to = nodeId(edge.to)
    const label = (edge.label ?? '').replace(/[|=.()]/g, '').trim()
    if (edge.kind === 'import') return `    ${from} --> ${to}`
    if (edge.kind === 'http') return label ? `    ${from} == ${label} ==> ${to}` : `    ${from} ==> ${to}`
    return label ? `    ${from} -. ${label} .-> ${to}` : `    ${from} -.-> ${to}`
}

function render(direction, entries, groups) {
    const lines = [`graph ${direction}`]
    const used = new Set()
    const folded = new Set()     // main.ts 的组件登记边折叠标记
    const draw = path => {
        if (used.has(path)) return
        used.add(path)
        const area = areaOf(path)
        const text = member(path)
        const name = path.startsWith('external:') ? `${path.replace('external:', '')}（npm）` : label(path)
        lines.push(`    ${nodeId(path)}["<b>${name}</b>${text ? `<br/>${text}` : ''}"]:::${area}`)
    }
    const collect = entry => {
        const picked = []
        if (nodes.has(entry) || entry.startsWith('external:')) picked.push(entry)
        else if (entry === 'ext-backends') { for (const path of nodes.keys()) if (/^extensions\/[\w-]+\/backend\.js$/.test(path)) picked.push(path) }
        else if (entry === 'ext-frontends') { for (const path of nodes.keys()) if (/^extensions\/[\w-]+\/frontend\/index\.js$/.test(path)) picked.push(path) }
        else { for (const path of nodes.keys()) if (path.startsWith(entry)) picked.push(path) }
        return picked
    }
    if (groups) {
        // 分组模式：每个 { title, entries } 一个 subgraph；未入组的端点画在组外。
        let index = 0
        const grouped = new Set()
        for (const group of groups) {
            lines.push(`    subgraph g${index}["${group.title}"]`)
            for (const path of group.entries.flatMap(collect)) { draw(path); grouped.add(path) }
            lines.push('    end')
            index++
        }
        for (const entry of entries.flatMap(collect)) if (!grouped.has(entry)) draw(entry)
    } else {
        for (const path of entries.flatMap(collect)) draw(path)
    }
    for (const edge of edges) {
        if (!used.has(edge.from) || !used.has(edge.to)) continue
        // main.ts 是装配点：对组件表项的登记边折叠成一条「装配」粗线，逐条画是噪音
        if (edge.from === 'web/src/main.ts' && edge.to.startsWith('web/src/') && edge.kind === 'import') {
            folded.add(edge.to)
            continue
        }
        lines.push(edgeLine(edge))
    }
    // 组件表在图里时，装配汇总成一条粗线；不在（如纯 backend 图）就不画。
    if (folded.size && used.has('web/src/Extension.ts')) {
        lines.push(`    ${nodeId('web/src/main.ts')} == 装配 ${folded.size} 个组件表项 ==> ${nodeId('web/src/Extension.ts')}`)
    }
    for (const [name, style] of Object.entries(AREA_STYLE)) lines.push(`    classDef ${name} ${style}`)
    return lines.join('\n')
}

// ---------- 图一：宏观（五个架构层各一个 subgraph；层内排列、层间连线）----------
const macro = render('TD', ['external:vue', 'external:@hugeicons', 'external:markstream-vue', 'external:highlight.js'], [
    { title: 'agent-core（npm，唯一循环）', entries: ['external:@kernel4632/agent-core'] },
    { title: 'backend —— Bun.serve 宿主', entries: ['backend/server.js', 'backend/features/'] },
    { title: 'web —— Vue3 宿主', entries: ['web/src/api.ts', 'web/src/Agent.ts', 'web/src/Extension.ts', 'web/src/main.ts', 'web/src/App.vue'] },
    { title: 'extensions —— 内置九个（后端）', entries: ['ext-backends'] },
])

// ---------- 图二：backend 九条 API 链路 ----------
const backDoc = await renderChains('backend')

// ---------- 图三：web 三条事件链路（发送 / SSE→状态→界面 / 连接生命周期）----------
const webDoc = await renderChains('web')

// ---------- 图四：extensions（宿主接口 / 扩展两组；manifest 的 requires-after-topology 边直连扩展节点）----------
const extDoc = render('TD', [], [
    { title: '宿主接口 —— 扩展从这里接入（ctx = Extension.scope）', entries: ['backend/features/Extension.js', 'backend/features/Agents.js', 'backend/features/Store.js', 'web/src/Extension.ts'] },
    { title: '内置扩展（后端 backend.js；前端入口由 Loader 打包）', entries: ['ext-backends'] },
])

// ---------- 汇总输出 ----------
const legend = `**图例（图一、图三、图四）**：实线 → import；粗线 ⇒ HTTP/SSE 数据流；虚线 ⇢ patch（扩展改写宿主方法）／inject（宿主反向注入）／扩展拓扑（requires/after）／登记。节点内是导出函数清单（超过 8 个显示 +n，本身就提示该文件该拆分）。图二的图例见其章节。`

const doc = `# 架构图

由 \`bun tools/architecture.js\` 从代码自动生成，勿手改；改了架构重新生成即可。

${legend}

## 一、宏观：五个架构层

每层一个分组框，**层间连线只有向下**（agent-core ← backend ← web/扩展 → 外部依赖）；
扩展组只有虚线（patch / 拓扑 / 登记）指向宿主——实线越层或跨组向上即违规。
节点内嵌导出函数清单（超 8 个显示 +n，本身就是该拆文件的信号）。

\`\`\`mermaid
${macro}
\`\`\`

## 二、backend：九条 API 链路

每条 HTTP 路由一个组（九组并排，组间零连线）。**菱形节点 = 条件分支**（边上标「是/否」）；
**红字斜体 = 错误 / 拒绝路径**（409 / 400 / 404）；**粗线 ⇒ 交给 agent-core**（唯一循环）。
节点按文件着色（server 橙 / Agents 蓝 / Stream 青 / Models 紫 / Store 藏蓝 / Extension 紫 / Loader 淡紫 / Bundle 沙金 / core 灰 / 浏览器 绿）。
HTTP 信封（json / fail / read）所有路由等价使用，与运行路径无关，不画。
链路声明在 \`tools/flow.js\`，引用的函数与源码扫描比对——改名或删函数会直接报错，图不会悄悄过期。

\`\`\`mermaid
${backDoc}
\`\`\`

## 三、web：三条事件链路

前端的运行单位是**事件流**：事件进来 → \`Agent.state\`（唯一真相源）变 → 界面响应式重渲染。
组件之间的 import 关系不是架构，故不画；响应式传播是 Vue 的事，图中只画一次「state → 界面」。
- **W① 发送**：敲字/回车后的分支（停止 / 继续 / 发送），不乐观渲染——用户消息等 core 收下才出现
- **W② SSE → 界面（核心）**：snapshot 整份重放、core 事件分四类入 state、\`History.group\` 纯函数派生、按 kind 分发组件
- **W③ 连接生命周期**：断线 1 秒重连，重新 snapshot 保证不丢帧不重帧

\`\`\`mermaid
${webDoc}
\`\`\`

## 四、extensions：宿主接口 ⇄ 内置扩展

左组是扩展的全部接入点：后端 \`ctx = Extension.scope\`（patch 链 / 登记表），前端 \`app\`（\`web/src/Extension.ts\`）。
右组九个扩展；**虚线 requires/after = manifest 拓扑**（后加载的可以依赖先加载的）、**patch = 扩展改写宿主方法**、
**登记工具/动作 = ctx.tool / ctx.op**。哪个扩展包住了哪个方法，看它发出的虚线指向谁。

\`\`\`mermaid
${extDoc}
\`\`\`

## 五、机器检查

\`\`\`
${violations.length ? violations.join('\n') : '  ✓ 全部通过：无循环依赖、扩展未绕 ctx、组件未绕 Agent、fetch 出口唯一、入口未被下游引用'}
\`\`\`
`

await writeFile(join(import.meta.dir, '..', 'docs', 'architecture.md'), doc)

if (process.argv.includes('--check')) {
    if (violations.length) {
        console.error(`架构检查未通过：\n${violations.join('\n')}`)
        process.exit(1)
    }
    console.log('架构检查通过：无循环依赖、无越层引用、fetch 出口唯一。')
} else {
    console.log(`docs/architecture.md 已生成：${nodes.size} 个节点、${edges.length} 条边${violations.length ? `；${violations.length} 条违规` : ''}`)
}
