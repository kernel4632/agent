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

// ---------- 数据面 ----------
const { nodes, edges, violations } = await build()

// 节点显示名：去掉前缀目录，保留区分度需要的部分。
function label(path) {
    const short = path.replace(/^backend\/(features\/)?/, '').replace(/^web\/src\/(components\/)?/, '').replace(/^extensions\//, '').replace(/\/(backend|frontend)\/index\.(js|vue|ts)$/, '').replace(/\.(js|ts|vue)$/, '')
    return short || path
}

// 节点内嵌的函数清单（导出非 default 的名字，最多 8 个，多了说明文件该拆了——本身就是信号）。
function member(path) {
    const names = nodes.get(path)?.exports ?? []
    if (!names.length) return ''
    const shown = names.slice(0, 8).map(name => `${name}()`).join('  ')
    return names.length > 8 ? `${shown} +${names.length - 8}` : shown
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
function render(direction, entries) {
    const lines = [`graph ${direction}`, `    %%{init: {'theme':'neutral','flowchart':{'curve':'basis'}}}%%`]
    const used = new Set()
    const draw = path => {
        if (used.has(path)) return
        used.add(path)
        const area = areaOf(path)
        const text = member(path)
        const name = path.startsWith('external:') ? `${path.replace('external:', '')}（npm）` : label(path)
        lines.push(`    ${nodeId(path)}["<b>${name}</b>${text ? `<br/>${text}` : ''}"]:::${area}`)
    }
    for (const entry of entries) {
        if (nodes.has(entry) || entry.startsWith('external:')) draw(entry)
        else if (entry === 'ext-backends') { for (const path of nodes.keys()) if (/^extensions\/[\w-]+\/backend\.js$/.test(path)) draw(path) }
        else if (entry === 'ext-manifests') { for (const path of nodes.keys()) if (path.endsWith('manifest.json')) draw(path) }
        else if (entry === 'ext-frontends') { for (const path of nodes.keys()) if (/^extensions\/[\w-]+\/frontend\/index\.js$/.test(path)) draw(path) }
        else { for (const path of nodes.keys()) if (path.startsWith(entry)) draw(path) }
    }
    for (const edge of edges) {
        if (!used.has(edge.from) || !used.has(edge.to)) continue
        const head = edge.kind === 'import' ? '-->' : edge.kind === 'http' ? '==>' : '-.->'
        const tag = edge.label ? `|${edge.label}|` : ''
        lines.push(`    ${nodeId(edge.from)} ${head}${tag ? ` ${tag}` : ''} ${nodeId(edge.to)}`)
    }
    for (const [name, style] of Object.entries(AREA_STYLE)) lines.push(`    classDef ${name} ${style}`)
    return lines.join('\n')
}

// ---------- 图一：宏观（每层代表 + 全部扩展后端 + 外部包）----------
const macro = render('TD', [
    'external:@kernel4632/agent-core', 'external:vue', 'external:@hugeicons',
    'backend/server.js',
    'backend/features/',
    'web/src/api.ts', 'web/src/Agent.ts', 'web/src/Extension.ts', 'web/src/main.ts', 'web/src/App.vue',
    'ext-backends',
])

// ---------- 图二：backend（含注入边和 agent-core）----------
const back = render('TD', ['backend/', 'external:@kernel4632/agent-core'])

// ---------- 图三：web（状态层 + 组件 + 外部渲染库）----------
const web = render('TD', ['web/src/'])

// ---------- 图四：extensions（拓扑 + patch/use + 扩展前端登记；前端文件不画，看 web 图）----------
const ext = render('TD', ['ext-backends', 'ext-manifests', 'ext-frontends', 'web/src/Extension.ts'])

// ---------- 汇总输出 ----------
const legend = `**图例**：实线 → import；粗线 ⇒ HTTP/SSE 数据流；虚线 ⇢ patch（扩展改写宿主方法）／inject（宿主反向注入）／扩展拓扑（requires/after）／登记。节点内是导出函数清单（超过 8 个显示 +n，本身就提示该文件该拆分）。`

const doc = `# 架构图

由 \`bun tools/architecture.js\` 从代码自动生成，勿手改；改了架构重新生成即可。

${legend}

## 一、宏观：core → 后端 → 前端 → 扩展

\`\`\`mermaid
${macro}
\`\`\`

## 二、backend features

\`\`\`mermaid
${back}
\`\`\`

## 三、web

\`\`\`mermaid
${web}
\`\`\`

## 四、extensions（拓扑：requires / after / patch / use）

\`\`\`mermaid
${ext}
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
