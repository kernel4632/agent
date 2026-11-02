/* 动态配色：只使用色彩算法，不引入任何控件。调用：applyTheme(appearance, 'dark')。 */
import { argbFromHex, hexFromArgb, Hct, SchemeTonalSpot, SchemeNeutral, SchemeVibrant, SchemeExpressive, SchemeMonochrome, SchemeFidelity, SchemeContent, SchemeRainbow, SchemeFruitSalad } from '@material/material-color-utilities'

const variants = { 'tonal-spot': SchemeTonalSpot, neutral: SchemeNeutral, vibrant: SchemeVibrant, expressive: SchemeExpressive, monochrome: SchemeMonochrome, fidelity: SchemeFidelity, content: SchemeContent, rainbow: SchemeRainbow, 'fruit-salad': SchemeFruitSalad }
const roles = ['surface', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest', 'onSurface', 'onSurfaceVariant', 'outlineVariant', 'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer', 'error', 'errorContainer', 'onErrorContainer', 'scrim']

/** 将偏好写成项目自己的 CSS 变量；根节点让原生顶层弹窗也能继承。 */
export function applyTheme(appearance, scheme) {
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
