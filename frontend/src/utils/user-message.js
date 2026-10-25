/**
 * 用户消息里的附件：发送时附件正文和消息拼成一个字符串交给模型，但界面只应显示文字和文件名。
 * 历史消息只能从这段字符串还原，所以解析和显示共用这一份规则。
 *
 * 发送格式（Chat.send）：
 *   正文
 *
 *   附件 "name.txt":
 *   文件内容
 *
 * 调用示例：
 *   const { content, attachments } = splitUserAttachments(message.content)
 */
const ATTACHMENT_HEADER = /\n\n附件 ("(?:[^"\\]|\\.)*"):\n/g

export function splitUserAttachments(raw) {
  const text = String(raw ?? '')
  const attachments = []
  let first = -1
  ATTACHMENT_HEADER.lastIndex = 0
  for (let match = ATTACHMENT_HEADER.exec(text); match; match = ATTACHMENT_HEADER.exec(text)) {
    if (first < 0) first = match.index
    try {
      const name = JSON.parse(match[1])
      if (typeof name === 'string' && name) attachments.push({ name })
    } catch {
      // 旧数据里的文件名已经损坏时跳过，不能因为一个附件把整条消息弄丢。
    }
  }
  return {
    content: first >= 0 ? text.slice(0, first).trimEnd() : text,
    attachments,
  }
}
