/*
 * 附件边界：类型和大小只在 utils/attachment.js 判断。
 * 这类错误是用户能自己改的，测试保证草稿页和会话页拿到同一句提示。
 * 图片是合法附件：PNG/JPEG/GIF/WebP 存成 dataUrl，别的图片类型和超大文件给原因。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_SIZE, MAX_IMAGE_SIZE, attachmentError, readAttachments } from "../src/utils/attachment.js"

test('accepts text and code files', () => {
  assert.equal(attachmentError({ name: 'src/App.vue', size: 1024, type: '' }), '')
  assert.equal(attachmentError({ name: 'notes.md', size: 1024, type: '' }), '')
  assert.match(ATTACHMENT_ACCEPT, /\.vue/)
  assert.match(ATTACHMENT_ACCEPT, /image\/png/)
})

test('accepts image files of supported types within the size limit', () => {
  assert.equal(attachmentError({ name: 'shot.png', size: 1024, type: 'image/png' }), '')
  assert.equal(attachmentError({ name: 'photo.jpg', size: MAX_IMAGE_SIZE, type: 'image/jpeg' }), '')
  assert.match(attachmentError({ name: 'anim.bmp', size: 1024, type: 'image/bmp' }), /支持的图片格式/)
  assert.match(attachmentError({ name: 'big.png', size: MAX_IMAGE_SIZE + 1, type: 'image/png' }), /5 MiB/)
})

test('rejects oversized and non-attachment files with a reason', () => {
  assert.match(attachmentError({ name: 'big.txt', size: MAX_ATTACHMENT_SIZE + 1, type: '' }), /1 MiB/)
  assert.match(attachmentError({ name: 'app.bin', size: 1024, type: '' }), /文本、代码和图片/)
})

test('reads accepted files and reports rejected ones', async () => {
  const accepted = new File(['hello'], 'notes.txt', { type: 'text/plain' })
  const rejected = new File(['png'], 'photo.bmp', { type: 'image/bmp' })
  const result = await readAttachments([accepted, rejected])
  assert.equal(result.files.length, 1)
  assert.equal(result.files[0].name, 'notes.txt')
  assert.equal(result.files[0].content, 'hello')
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /支持的图片格式/)
})

test('图片附件存成 dataUrl，文本附件存成 content', async () => {
  const image = new File(['fakepng'], 'shot.png', { type: 'image/png' })
  const text = new File(['hello'], 'notes.txt', { type: 'text/plain' })
  const result = await readAttachments([image, text])
  assert.equal(result.files.length, 2)
  const [imageFile, textFile] = result.files
  assert.equal(imageFile.kind, 'image')
  assert.match(imageFile.dataUrl, /^data:image\/png;base64,/)
  assert.equal(imageFile.content, undefined)
  assert.equal(textFile.kind, undefined)
  assert.equal(textFile.content, 'hello')
})
