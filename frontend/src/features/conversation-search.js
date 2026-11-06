/*
 * 会话搜索：只把聊天里看得见的正文拉成可搜索文本。
 * 工具参数和过程日志不进入结果，避免跳到一个折叠起来、看不到内容的步骤。
 */

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim()
const readable = value => clean(String(value ?? '')
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[*_~`>#]/g, ''))

function contentText(value) {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map(part => typeof part === 'string' ? part : part?.text || '')
    .join(' ')
}

function messageText(message) {
  if (!message || message.compact) return ''
  const body = contentText(message.displayContent ?? message.content)
  if (message.role === 'user') return readable(body)
  if (body.trim()) return readable(body)
  const steps = Array.isArray(message.steps) ? message.steps : []
  return readable(steps
    .filter(step => step?.type === 'text')
    .map(step => step.text)
    .join(' '))
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
    const start = Math.max(0, index - 36)
    const end = Math.min(text.length, index + needle.length + 90)
    results.push({
      id: message.id,
      before: `${start ? '…' : ''}${text.slice(start, index)}`,
      match: text.slice(index, index + needle.length),
      after: `${text.slice(index + needle.length, end)}${end < text.length ? '…' : ''}`,
    })
    if (results.length >= limit) break
  }
  return results
}
