/*
 * 会话搜索：只把聊天里看得见的正文拉成可搜索文本。
 * 工具参数和过程日志不进入结果，避免跳到一个折叠起来、看不到内容的步骤。
 * 结果保留 Markdown 原文，由界面渲染后再截断。
 */

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim()

function contentText(value) {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map(part => typeof part === 'string' ? part : part?.text || '')
    .join('\n\n')
}

function messageText(message) {
  if (!message || message.compact) return ''
  const body = contentText(message.displayContent ?? message.content).trim()
  if (message.role === 'user') return body
  if (body) return body
  const steps = Array.isArray(message.steps) ? message.steps : []
  return steps
    .filter(step => step?.type === 'text')
    .map(step => step.text)
    .join('\n\n')
    .trim()
}

// 取命中位置所在的 Markdown 段落，连同标题、列表、代码块等标记一起交给渲染器。
function blockOf(text, index, queryLength) {
  let start = text.lastIndexOf('\n\n', index)
  start = start < 0 ? 0 : start + 2
  let end = text.indexOf('\n\n', index)
  end = end < 0 ? text.length : end
  let block = text.slice(start, end).trim()
  if (block.length > 800) {
    const local = Math.max(0, index - start)
    block = block.slice(Math.max(0, local - 180), Math.min(block.length, local + queryLength + 320)).trim()
    block = `…${block}`
  }
  return block
}

export function searchConversation(messages = [], query = '', limit = 50) {
  const needle = clean(query)
  const lower = needle.toLocaleLowerCase()
  if (!needle) return []
  const results = []
  for (const message of messages) {
    const text = messageText(message)
    if (!text) continue
    const index = text.toLocaleLowerCase().indexOf(lower)
    if (index < 0) continue
    results.push({ id: message.id, markdown: blockOf(text, index, needle.length) })
    if (results.length >= limit) break
  }
  return results
}
