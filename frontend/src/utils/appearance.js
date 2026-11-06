/* 外观偏好：主题色与浏览器保存归同一个功能；控件只消费 CSS 变量。
 * 调用：Appearance.apply(appearance, 'dark')；Appearance.save(appearance)。
 */
import { argbFromHex, hexFromArgb, Hct, SchemeTonalSpot, SchemeNeutral, SchemeVibrant, SchemeExpressive, SchemeMonochrome, SchemeFidelity, SchemeContent, SchemeRainbow, SchemeFruitSalad } from '@material/material-color-utilities'

const variants = { 'tonal-spot': SchemeTonalSpot, neutral: SchemeNeutral, vibrant: SchemeVibrant, expressive: SchemeExpressive, monochrome: SchemeMonochrome, fidelity: SchemeFidelity, content: SchemeContent, rainbow: SchemeRainbow, 'fruit-salad': SchemeFruitSalad }
const roles = ['surface', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest', 'onSurface', 'onSurfaceVariant', 'outlineVariant', 'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer', 'error', 'errorContainer', 'onErrorContainer', 'scrim']

// 动效速度档位：standard 是基准 1x，expressive 放慢 1.25x，quick 加快 0.7x，off 直接归零（配合 reduceMotion）。
const MOTION_SCALE = { standard: 1, expressive: 1.25, quick: .7, off: .01 }

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
  // --- 可视化自定义扩展：圆角、密度、动效速度 ---
  root.style.setProperty('--la-radius', `${appearance.radius ?? 10}px`)                     // 控件圆角大小
  root.style.setProperty('--la-radius-panel', `${Math.round((appearance.radius ?? 10) * 2.4)}px`) // 面板圆角跟随等比缩放
  root.style.setProperty('--la-density-gap', `${(appearance.density ?? 0) * 4}px`)          // 密度：每档 4px 间距增量
  root.style.setProperty('--la-motion-enter', `${Math.round(200 * (MOTION_SCALE[appearance.motion] ?? 1))}ms`) // 动效时长
  root.style.setProperty('--la-motion-exit', `${Math.round(150 * (MOTION_SCALE[appearance.motion] ?? 1))}ms`)
}


const appearanceKey = 'agent.appearance'

function persistAppearance(appearance) {
  try {
    localStorage.setItem(appearanceKey, JSON.stringify(appearance))
  } catch { /* localStorage 不可用时静默忽略 */ }
}

export const Appearance = { apply: applyTheme, save: persistAppearance }
