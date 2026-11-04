/*
 * 统一 diff 文本高亮：不依赖工具名，只看内容是不是 unified diff。
 * 命令在非 TTY 里通常不会带 ANSI，所以这里给纯文本 diff 补上增删行颜色。
 * 调用示例：diffToHtml('diff --git a/a b/b\n+new\n-old')
 */
const escapeHtml = value => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

export function looksLikeDiff(text) {
  if (typeof text !== 'string') return false
  return /^diff --git /m.test(text) || (/^@@ .* @@/m.test(text) && /^[+-]/m.test(text))
}

export function diffToHtml(input) {
  const lines = String(input ?? '').replace(/\r\n/g, '\n').split('\n')
  return lines.map(line => {
    let kind = 'context'
    if (/^diff --git /.test(line)) kind = 'meta'
    else if (/^(index |new file |deleted file |similarity index |rename )/.test(line)) kind = 'meta'
    else if (/^(--- |\+\+\+ )/.test(line)) kind = 'header'
    else if (/^@@/.test(line)) kind = 'hunk'
    else if (/^\+/.test(line)) kind = 'add'
    else if (/^-/.test(line)) kind = 'del'
    else if (/^\\ No newline/.test(line)) kind = 'meta'
    const body = line ? escapeHtml(line) : '&nbsp;'
    return `<span class="diff-line diff-${kind}">${body}</span>`
  }).join('')
}
