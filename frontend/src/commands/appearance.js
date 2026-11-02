/* 外观偏好：主题色与浏览器保存归同一个功能；控件只消费 CSS 变量。
 * 调用：Appearance.apply(appearance, 'dark')；Appearance.save(appearance)。
 */
import { argbFromHex, hexFromArgb, Hct, SchemeTonalSpot, SchemeNeutral, SchemeVibrant, SchemeExpressive, SchemeMonochrome, SchemeFidelity, SchemeContent, SchemeRainbow, SchemeFruitSalad } from '@material/material-color-utilities'

const variants = { 'tonal-spot': SchemeTonalSpot, neutral: SchemeNeutral, vibrant: SchemeVibrant, expressive: SchemeExpressive, monochrome: SchemeMonochrome, fidelity: SchemeFidelity, content: SchemeContent, rainbow: SchemeRainbow, 'fruit-salad': SchemeFruitSalad }
const roles = ['surface', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest', 'onSurface', 'onSurfaceVariant', 'outlineVariant', 'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer', 'error', 'errorContainer', 'onErrorContainer', 'scrim']

/** 将偏好写成项目自己的 CSS 变量；根节点让原生顶层弹窗也能继承。 */
function applyTheme(appearance, scheme) {
  const root = document.documentElement
  const dark = scheme === 'dark'
  const Palette = variants[appearance.variant] || SchemeTonalSpot
  const palette = new Palette(Hct.fromInt(argbFromHex(appearance.color)), dark, { standard: 0, medium: .5, high: 1 }[appearance.contrast] ?? 0)
  for (const role of roles) {
    const name = role.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
    root.style.setProperty(`--ui-color-${name}`, hexFromArgb(palette[role]))
  }
  root.style.setProperty('--ui-color-success', dark ? '#91d5a3' : '#286b3b')
  root.style.setProperty('--ui-color-warning', dark ? '#f3ca86' : '#805600')
  root.dataset.theme = scheme
  root.toggleAttribute('data-reduced-motion', appearance.reduceMotion)
  root.toggleAttribute('data-strong-focus', appearance.strongFocus)
}


const appearanceKey = 'agent.appearance'

function persistAppearance(appearance) {
  try {
    localStorage.setItem(appearanceKey, JSON.stringify(appearance))
  } catch { /* localStorage 不可用时静默忽略 */ }
}

export const Appearance = { apply: applyTheme, save: persistAppearance }
