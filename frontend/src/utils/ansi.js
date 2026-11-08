/*
 * 终端 ANSI SGR 转 HTML：只解释颜色/粗体/下划线等文本样式，丢弃光标移动等控制序列。
 * 所有正文都先转义，再包 span，因此可以安全放进 v-html。
 * 调用示例：ansiToHtml('\x1b[31mred\x1b[0m')
 */
import escapeHtml from 'escape-html'   // 转义统一用库：三个文件各写一份手写实现，漏改一处就是 XSS

const ESC = '\u001b'
const ANSI_TOKEN = new RegExp(`${ESC}\\[([0-9;?]*)([A-Za-z])`, 'g')
const BASIC = [
  '#4b5563', '#ef4444', '#22c55e', '#eab308', '#3b82f6', '#d946ef', '#06b6d4', '#e5e7eb',
  '#6b7280', '#f87171', '#4ade80', '#facc15', '#60a5fa', '#e879f9', '#22d3ee', '#f9fafb',
]

function xtermColor(index) {
  if (index < 16) return BASIC[index] || null
  if (index < 232) {
    const value = index - 16
    const levels = [0, 95, 135, 175, 215, 255]
    const r = levels[Math.floor(value / 36)]
    const g = levels[Math.floor(value / 6) % 6]
    const b = levels[value % 6]
    return `rgb(${r},${g},${b})`
  }
  const value = 8 + (index - 232) * 10
  return `rgb(${value},${value},${value})`
}

export const hasAnsi = text => typeof text === 'string' && new RegExp(`${ESC}\\[`).test(text)

export function ansiToHtml(input) {
  const text = String(input ?? '').replace(/\r\n/g, '\n')
  let fgClass = ''
  let bgClass = ''
  let fgStyle = ''
  let bgStyle = ''
  let bold = false
  let dim = false
  let italic = false
  let underline = false
  let out = ''
  let last = 0

  const push = value => {
    if (!value) return
    const classes = ['ansi', fgClass, bgClass, bold && 'ansi-bold', dim && 'ansi-dim', italic && 'ansi-italic', underline && 'ansi-underline'].filter(Boolean).join(' ')
    const styles = [fgStyle && `color:${fgStyle}`, bgStyle && `background-color:${bgStyle}`].filter(Boolean).join(';')
    out += `<span${classes ? ` class="${classes}"` : ''}${styles ? ` style="${styles}"` : ''}>${escapeHtml(value)}</span>`
  }

  const apply = params => {
    const codes = (params || '0').split(';').filter(Boolean).map(Number)
    if (!codes.length) codes.push(0)
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i]
      if (code === 0) { fgClass = ''; bgClass = ''; fgStyle = ''; bgStyle = ''; bold = false; dim = false; italic = false; underline = false }
      else if (code === 1) bold = true
      else if (code === 2) dim = true
      else if (code === 3) italic = true
      else if (code === 4) underline = true
      else if (code === 22) { bold = false; dim = false }
      else if (code === 23) italic = false
      else if (code === 24) underline = false
      else if (code >= 30 && code <= 37) { fgClass = `ansi-fg-${code}`; fgStyle = '' }
      else if (code === 39) { fgClass = ''; fgStyle = '' }
      else if (code >= 40 && code <= 47) { bgClass = `ansi-bg-${code}`; bgStyle = '' }
      else if (code === 49) { bgClass = ''; bgStyle = '' }
      else if (code >= 90 && code <= 97) { fgClass = `ansi-fg-${code}`; fgStyle = '' }
      else if (code >= 100 && code <= 107) { bgClass = `ansi-bg-${code}`; bgStyle = '' }
      else if (code === 38 || code === 48) {
        const target = code === 38
        if (codes[i + 1] === 5 && Number.isFinite(codes[i + 2])) {
          const color = xtermColor(codes[i + 2])
          if (color) { if (target) { fgClass = ''; fgStyle = color } else { bgClass = ''; bgStyle = color } }
          i += 2
        } else if (codes[i + 1] === 2 && codes.slice(i + 2, i + 5).length === 3) {
          const color = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`
          if (target) { fgClass = ''; fgStyle = color } else { bgClass = ''; bgStyle = color }
          i += 4
        }
      }
    }
  }

  let match
  while ((match = ANSI_TOKEN.exec(text))) {
    push(text.slice(last, match.index))
    if (match[2] === 'm') apply(match[1])
    last = ANSI_TOKEN.lastIndex
  }
  push(text.slice(last))
  return out
}
