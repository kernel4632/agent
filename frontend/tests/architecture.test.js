/* 前端依赖约束：功能不能回调组件，任何源码导入不能成环。运行 bun run test。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../src/', import.meta.url))
const files = readdirSync(src, { recursive: true }).filter(file => /\.(js|vue)$/.test(file))
const graph = new Map(files.map(file => [resolve(src, file), []]))
for (const [file, edges] of graph) {
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--([\s\S]*?)-->/g, '')
  for (const match of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)['"](\.[^'"]+)['"]/g)) {
    const target = resolve(dirname(file), match[1])
    if (graph.has(target)) edges.push(target)
  }
}

test('前端源码没有循环导入', () => {
  const visited = new Set()
  const stack = []
  function visit(file) {
    assert.ok(!stack.includes(file), `循环：${[...stack, file].map(item => item.slice(src.length)).join(' → ')}`)
    if (visited.has(file)) return
    stack.push(file)
    graph.get(file).forEach(visit)
    stack.pop()
    visited.add(file)
  }
  graph.forEach((_, file) => visit(file))
})

test('commands 不导入视觉组件，基础 UI 不调用业务功能', () => {
  for (const [file, targets] of graph) {
    const name = file.slice(src.length).replaceAll('\\', '/')
    if (name.startsWith('commands/')) assert.ok(targets.every(target => !target.endsWith('.vue')), name)
    if (name.startsWith('commands/') && name !== 'commands/navigation.js') {
      assert.ok(!targets.includes(resolve(src, 'commands/navigation.js')), `${name} 不应反向依赖导航`)
    }
    if (name.startsWith('ui/')) assert.ok(targets.every(target => !target.slice(src.length).replaceAll('\\', '/').startsWith('commands/')), name)
  }
})
