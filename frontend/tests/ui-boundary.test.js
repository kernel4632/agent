/*
 * 前端 UI 边界检查：业务页面只能从 ui/index.js 拿控件，也不能直接 import KIMA。
 *
 * 这是组件库适配层最重要的一条约束；漏一处，换组件库时就要改业务页面。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../src', import.meta.url))
const direct = []
const kima = []
const allowed = /^ui\/index\.js$/
const componentNames = 'AppIcon|Button|Dialog|Field|IconButton|Switch'

const walk = directory => {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) { walk(path); continue }
    if (!name.endsWith('.vue') && !name.endsWith('.js')) continue
    const relative = path.slice(src.length + 1).replace(/\\/g, '/')
    if (relative.startsWith('ui/') || relative.startsWith('theme/')) continue
    if (allowed.test(relative)) continue
    const text = readFileSync(path, 'utf8')
    if (new RegExp(`from ['"][^'"]*/ui/(?:${componentNames})\\.vue['"]`).test(text)) direct.push(relative)
    if (/from ['"]@kernel4632\/kima['"]/.test(text)) kima.push(relative)
  }
}
walk(src)

test('页面不直接引用 ui/*.vue', () => {
    assert.deepEqual(direct, [])
})

test('页面不直接引用 KIMA，只经过 ui/index.js', () => {
    assert.deepEqual(kima, [])
})
