/*
M3E 主题适配：M3E 的颜色 token 定义在 m3e-theme 内部，页面样式读不到。
这里从 m3e-theme 的元素计算样式里读取 token，再写到 document.documentElement（:root），让全局 CSS 可用。
换主题库时替换本文件和 ThemeProvider.vue，页面不需要知道 M3E。
调用示例：syncM3ETokens(themeElement)
*/

// --- 需要同步到 :root 的 M3E 颜色 token ---
// 只搬运页面实际用到的颜色角色，新增用途时在这里补一行。
export const M3E_TOKENS = [
  '--md-sys-color-background',
  '--md-sys-color-on-background',
  '--md-sys-color-surface',
  '--md-sys-color-surface-dim',
  '--md-sys-color-surface-bright',
  '--md-sys-color-surface-container-lowest',
  '--md-sys-color-surface-container-low',
  '--md-sys-color-surface-container',
  '--md-sys-color-surface-container-high',
  '--md-sys-color-surface-container-highest',
  '--md-sys-color-on-surface',
  '--md-sys-color-on-surface-variant',
  '--md-sys-color-surface-variant',
  '--md-sys-color-surface-tint',
  '--md-sys-color-inverse-surface',
  '--md-sys-color-inverse-on-surface',
  '--md-sys-color-inverse-primary',
  '--md-sys-color-primary',
  '--md-sys-color-primary-dim',
  '--md-sys-color-on-primary',
  '--md-sys-color-primary-container',
  '--md-sys-color-on-primary-container',
  '--md-sys-color-secondary',
  '--md-sys-color-on-secondary',
  '--md-sys-color-secondary-container',
  '--md-sys-color-on-secondary-container',
  '--md-sys-color-tertiary',
  '--md-sys-color-on-tertiary',
  '--md-sys-color-tertiary-container',
  '--md-sys-color-on-tertiary-container',
  '--md-sys-color-error',
  '--md-sys-color-on-error',
  '--md-sys-color-error-container',
  '--md-sys-color-on-error-container',
  '--md-sys-color-outline',
  '--md-sys-color-outline-variant',
  '--md-sys-color-shadow',
  '--md-sys-color-scrim',
]

// --- 从 m3e-theme 读取 token 并写到 :root ---
// theme 必须是已挂载的 m3e-theme 元素；未挂载时传 null 会直接跳过。
export function syncM3ETokens(theme) {
  if (!theme) return                                                // 未挂载时跳过
  const computed = getComputedStyle(theme)                          // 读取 m3e-theme 的计算样式
  const root = document.documentElement                             // 写入目标：:root
  for (const token of M3E_TOKENS) {
    const value = computed.getPropertyValue(token).trim()           // 读取每个 token 的实际值
    if (value) root.style.setProperty(token, value)                 // 有值才写入，避免覆盖空值
  }
}
