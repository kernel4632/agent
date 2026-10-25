/*
 * 附件边界：类型和大小只允许在 utils/attachments.js 判断。
 * 这类错误是用户能自己改的，测试保证草稿页和会话页拿到同一句提示。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_SIZE, attachmentError, readAttachments } from '../src/utils/attachments.js'

test('accepts text and code files', () => {
  assert.equal(attachmentError({ name: 'src/App.vue', size: 1024 }), '')
  assert.equal(attachmentError({ name: 'notes.md', size: 1024 }), '')
  assert.match(ATTACHMENT_ACCEPT, /\.vue/)
})

test('rejects oversized and binary files with a reason', () => {
  assert.match(attachmentError({ name: 'big.txt', size: MAX_ATTACHMENT_SIZE + 1 }), /1 MiB/)
  assert.match(attachmentError({ name: 'photo.png', size: 1024 }), /文本与代码/)
})

test('reads accepted files and reports rejected ones', async () => {
  const accepted = new File(['hello'], 'notes.txt', { type: 'text/plain' })
  const rejected = new File(['png'], 'photo.png', { type: 'image/png' })
  const result = await readAttachments([accepted, rejected])
  assert.equal(result.files.length, 1)
  assert.equal(result.files[0].name, 'notes.txt')
  assert.equal(result.files[0].content, 'hello')
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /文本与代码/)
})
