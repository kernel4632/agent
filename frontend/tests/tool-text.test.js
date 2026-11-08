import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ansiToHtml, hasAnsi } from '../src/utils/ansi.js'
import { diffToHtml, looksLikeDiff } from '../src/utils/diff.js'
import { subagentSteps, applySubagentEvent } from "../src/utils/tool.js"

test('ANSI SGR maps basic colors and escapes html', () => {
  assert.equal(hasAnsi('\u001b[31mred\u001b[0m'), true)
  const html = ansiToHtml('\u001b[31m<img src=x onerror=alert(1)>\u001b[0m')
  // 颜色走 CSS 变量，暗色主题下会跟着换；不是写死的具体色值
  assert.match(html, /var\(--ansi-red/)
  assert.match(html, /&lt;img/)
  assert.doesNotMatch(html, /<img/)
})

test('ANSI 256 color is converted to rgb', () => {
  const html = ansiToHtml('\u001b[38;5;196mX')
  // 256 色没有对应的主题变量，直接落成具体色值
  assert.match(html, /color:rgb\(255,0,0\)/)
  assert.equal(hasAnsi('plain text'), false)
})

// 转义统一走 escape-html：三个文件（ansi / diff / markdown）共用同一套规则。
// 以前各写一份，哪天改一处忘另两处就是一个 XSS 口子，所以用测试锁住。
test('every ANSI and diff path escapes the same five characters', () => {
  const dangerous = `<script>alert("x&y")</script>'`
  const ansi = ansiToHtml(`\u001b[32m${dangerous}\u001b[0m`)
  const diff = diffToHtml(`+${dangerous}`)
  for (const html of [ansi, diff]) {
    assert.match(html, /&lt;/, '尖括号要转义')
    assert.match(html, /&amp;/, '与符号要转义')
    assert.match(html, /&quot;/, '双引号要转义')
    assert.match(html, /&#39;/, '单引号要转义')
    assert.doesNotMatch(html, /<script/, '不能留下可执行标签')
  }
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
test('subagent result steps are restored recursively', () => {
  const output = {
    type: 'json',
    value: {
      description: '查资料',
      steps: [{
        id: 'read-1', type: 'tool', name: 'read_file', status: 'completed',
        input: { path: 'a.txt' }, output: { type: 'text', value: '内容' },
      }],
    },
  }
  const steps = subagentSteps(output, 'task-1')
  assert.equal(steps.length, 1)
  assert.equal(steps[0].name, 'read_file')
  assert.equal(steps[0].status, 'completed')
  assert.match(steps[0].preview, /内容/)
})

test('live subagent events update the parent tool branch', () => {
  const parent = { id: 'task-1', subagentSteps: [] }
  applySubagentEvent(parent, { type: 'subagent-tool', toolCallId: 'read-1', toolName: 'read_file', input: { path: 'a.txt' } })
  applySubagentEvent(parent, { type: 'subagent-tool-result', toolCallId: 'read-1', output: { type: 'text', value: '内容' } })
  assert.equal(parent.subagentSteps.length, 1)
  assert.equal(parent.subagentSteps[0].status, 'completed')
  assert.match(parent.subagentSteps[0].preview, /内容/)
})
