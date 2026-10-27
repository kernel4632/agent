/*
全局主题常量：集中管理可全局调整的视觉参数。
修改此文件的值即可统一影响所有使用该常量的组件，无需逐个修改。
调用示例：import { ICON_STROKE_WIDTH } from './index.js'
*/

// --- 图标线条粗细 ---
// 所有 AppIcon 都从这里取线宽。KimaIcon 会把它当成屏幕上的绝对像素，
// 所以 18px 的小图标用 1.5px 正好；2px 会显得又黑又重。
export const ICON_STROKE_WIDTH = 1.5

// --- M3E ThemeElement 的完整可配置面 ---
export const DEFAULT_APPEARANCE = Object.freeze({
  theme: 'light',
  color: '#3b5cf6',
  variant: 'tonal-spot',
  contrast: 'standard',
  density: 0,
  motion: 'standard',
  strongFocus: false,
  reduceMotion: false,
})

export function normalizeAppearance(value = {}) {
  return { ...DEFAULT_APPEARANCE, ...(value && typeof value === 'object' ? value : {}) }
}
