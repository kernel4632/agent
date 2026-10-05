// 清理 Figma 抽取数据，只保留前端能用的字段。
// 运行：bun run design/figma/scripts/clean.mjs
// 幂等：可重复运行。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const figmaDir = join(here, '..')
const tokensFile = join(figmaDir, 'tokens', 'design-tokens.json')
const hierarchyFile = join(figmaDir, 'raw', 'hierarchy.json')
const componentsFile = join(figmaDir, 'raw', 'components.json')

const read = (file) => JSON.parse(readFileSync(file, 'utf8'))
const write = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')

// 前端用不到的标识类字段：节点 id、组件 key、实例 componentId
const STRIP_NODE_FIELDS = new Set(['i', 'comp', 'inst', 'componentId'])
// 前端不用的顶层画板：图标陈列板、组件陈列板；以及已确认不要的 Settings Modal
const DROP_ROOTS = new Set(['图标', '组件', 'Settings Modal'])

function cleanNode(node) {
  const out = {}
  for (const [key, value] of Object.entries(node)) {
    if (STRIP_NODE_FIELDS.has(key)) continue
    out[key] = key === 'c' ? value.map(cleanNode) : value
  }
  return out
}

function cleanComponents(data) {
  const components = data.components
    .filter((c) => c.category !== 'icon') // 图标用 Hugeicons 库，不保留
    .map((c) => {
      const out = {}
      for (const [key, value] of Object.entries(c)) {
        if (key === 'id' || key === 'key') continue
        out[key] = key === 'variants'
          ? value.map((v) => {
              const variant = {}
              for (const [vk, vv] of Object.entries(v)) if (vk !== 'id' && vk !== 'key') variant[vk] = vv
              return variant
            })
          : value
      }
      return out
    })
  return { ...data, components }
}

const tokens = read(tokensFile)
const hierarchy = read(hierarchyFile)
const components = read(componentsFile)

const cleanedHierarchy = {
  ...hierarchy,
  roots: hierarchy.roots.filter((r) => !DROP_ROOTS.has(r.n)).map(cleanNode)
}

write(tokensFile, tokens)
write(hierarchyFile, cleanedHierarchy)
write(componentsFile, cleanComponents(components))

console.log('tokens      : 未改动（本身无标识字段）')
console.log(`hierarchy   : 顶层 ${hierarchy.roots.length} -> ${cleanedHierarchy.roots.length}（${cleanedHierarchy.roots.map((r) => r.n).join('、')}）`)
console.log(`components  : ${components.components.length} -> ${cleanComponents(components).components.length}（移除图标类）`)
