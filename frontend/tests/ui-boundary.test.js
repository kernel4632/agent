/*
 * 前端 UI 边界检查：页面只能从 ui/index.js 拿基础控件，不能直接 import ui/*.vue。
 *
 * 这是换 KIMA 组件库前最重要的一条约束；漏一处，换库时就会在页面里留下旧组件。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../src', import.meta.url))
const direct = []
const allowed = /^ui\/index\.js$/
const componentNames = 'AppIcon|Button|Dialog|Field|IconButton|Select|Switch'

const walk = directory => {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) { walk(path); continue }
    if (!name.endsWith('.vue') && !name.endsWith('.js')) continue
    const relative = path.slice(src.length + 1).replace(/\\/g, '/')
    if (allowed.test(relative)) continue
    const text = readFileSync(path, 'utf8')
    if (new RegExp(`from ['"][^'"]*/ui/(?:${componentNames})\\.vue['"]`).test(text)) direct.push(relative)
  }
}
walk(src)

test('页面不直接引用 ui/*.vue', () => {
    assert.deepEqual(direct, [])
})
