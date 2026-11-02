/* UI 边界检查：阻止组件库重新混入，确保每个 Vue 都有独立同名 SCSS。运行 bun run test。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../src', import.meta.url))
const files = readdirSync(src, { recursive: true }).filter(file => /\.(vue|js|scss)$/.test(file))

test('业务页面从 ui/index.js 使用自有控件', () => {
  const direct = files.filter(file => !/^(ui|theme)[\\/]/.test(file) && /from ['"][^'"]*\/ui\/[^'"]+\.vue['"]/.test(readFileSync(join(src, file), 'utf8')))
  assert.deepEqual(direct, [])
})

test('运行源码和依赖均不再引用外部 UI 组件库', () => {
  const forbidden = /@kernel4632\/kima|@m3e\/|\bKima[A-Z]|--kima-|m3e-theme/
  assert.deepEqual(files.filter(file => forbidden.test(readFileSync(join(src, file), 'utf8'))), [])
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(manifest.dependencies).filter(name => forbidden.test(name)), [])
})

test('每个 Vue 组件只有一个对应的外部 SCSS 文件', () => {
  for (const file of files.filter(file => file.endsWith('.vue'))) {
    const full = join(src, file)
    const text = readFileSync(full, 'utf8')
    const blocks = [...text.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/g)]
    assert.equal(blocks.length, 1, file)
    assert.equal(blocks[0][2].trim(), '', `${file} 不应内嵌样式正文`)
    const source = blocks[0][1].match(/src="([^"]+)"/)?.[1]
    assert.ok(source, `${file} 缺少外部样式`)
    const target = resolve(dirname(full), source)
    assert.equal(relative(src, target), join('styles', file.replace(/\.vue$/, '.scss')), file)
    assert.ok(existsSync(target), `${file} 的样式文件不存在`)
  }
})
