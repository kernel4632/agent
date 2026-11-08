/*
 * 终端 ANSI SGR 转 HTML：把命令输出里的颜色/粗体/下划线等样式翻成 span。
 *
 * 解析交给 fancy-ansi：它输出 `color:var(--ansi-red, #cc0000)` 这种形式，
 * 所以颜色由主题变量决定，暗色界面下会跟着换（以前这套颜色是硬编码的，
 * 切到暗色主题时终端输出仍然是浅色主题的配色）。
 * 变量在 styles/tokens.scss 里定义，明暗各一套。
 *
 * 调用示例：
 *   hasAnsi(text)           // 有没有 ANSI 标记
 *   ansiToHtml(text)        // 转成可放进 v-html 的 HTML（内容已转义）
 */
import { FancyAnsi, hasAnsi as fancyHasAnsi } from 'fancy-ansi'

// OSC 8 超链接保持关闭：URL 来自命令输出，不应该变成可点击目标。
const converter = new FancyAnsi({ hyperlinks: false })

export const hasAnsi = text => typeof text === 'string' && fancyHasAnsi(text)

export function ansiToHtml(input) {
  return converter.toHtml(String(input ?? '').replace(/\r\n/g, '\n'))
}
