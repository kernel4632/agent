import test from 'node:test'
import assert from 'node:assert/strict'
import { splitUserAttachments } from '../src/utils/user-message.js'

test('用户气泡从历史输入里剥掉附件正文', () => {
  const raw = '看看附件\n\n附件 "a.txt":\nsecret\n\n附件 "b.txt":\nmore'
  assert.deepEqual(splitUserAttachments(raw), {
    content: '看看附件',
    attachments: [{ name: 'a.txt' }, { name: 'b.txt' }],
  })
})

test('没有附件的历史消息原样保留', () => {
  assert.deepEqual(splitUserAttachments('只是普通消息\n\n第二段'), {
    content: '只是普通消息\n\n第二段',
    attachments: [],
  })
})
