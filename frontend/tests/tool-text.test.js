import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ansiToHtml, hasAnsi } from '../src/utils/ansi.js'
import { diffToHtml, looksLikeDiff } from '../src/utils/diff.js'

test('ANSI SGR maps basic colors and escapes html', () => {
  assert.equal(hasAnsi('\u001b[31mred\u001b[0m'), true)
  const html = ansiToHtml('\u001b[31m<img src=x onerror=alert(1)>\u001b[0m')
  assert.match(html, /ansi-fg-31/)
  assert.match(html, /&lt;img/)
  assert.doesNotMatch(html, /<img/)
})

test('ANSI 256 color is converted to rgb', () => {
  const html = ansiToHtml('\u001b[38;5;196mX')
  assert.match(html, /color:rgb\(255,0,0\)/)
  assert.equal(hasAnsi('plain text'), false)
})

test('unified diff colors additions, deletions and hunks', () => {
  const text = 'diff --git a/a b/b\n--- a/a\n+++ b/b\n@@ -1 +1 @@\n-old\n+new\n context'
  assert.equal(looksLikeDiff(text), true)
  const html = diffToHtml(text)
  assert.match(html, /diff-add[^>]*>\+new/)
  assert.match(html, /diff-del[^>]*>-old/)
  assert.match(html, /diff-hunk/)
  assert.match(html, /diff-header/)
  assert.equal(looksLikeDiff('+ not a diff'), false)
  assert.equal(looksLikeDiff('just normal output'), false)
})
