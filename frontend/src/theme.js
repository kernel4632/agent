/*
全局主题常量：集中管理可全局调整的视觉参数。
修改此文件的值即可统一影响所有使用该常量的组件，无需逐个修改。
调用示例：import { ICON_STROKE_WIDTH } from '../theme.js'
*/

// --- 图标线条粗细 ---
// 所有 HugeiconsIcon 组件通过此常量统一控制 strokeWidth，方便全局调整。
// hugeicons 推荐范围 1–2，默认 1.5，视觉较粗可调至 2。
export const ICON_STROKE_WIDTH = 1.5
