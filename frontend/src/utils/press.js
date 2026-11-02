/* 按压反馈：供按钮的 @pointerdown="press" 使用，光圈由 CSS 绘制，结束后清理。 */
export function press(event) {
  const button = event.currentTarget
  if (button.disabled || event.button !== 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.hasAttribute('data-reduced-motion')) return
  const box = button.getBoundingClientRect() // 从按下的位置开始扩散
  const ripple = document.createElement('span')
  ripple.className = 'ui-ripple'
  ripple.setAttribute('aria-hidden', 'true')
  ripple.style.setProperty('--ripple-x', `${event.clientX - box.left}px`)
  ripple.style.setProperty('--ripple-y', `${event.clientY - box.top}px`)
  ripple.style.setProperty('--ripple-size', `${Math.max(box.width, box.height) * 2}px`)
  button.appendChild(ripple)
  ripple.addEventListener('animationend', () => ripple.remove(), { once: true })
  setTimeout(() => ripple.remove(), 700) // 动画中途被用户关闭时也回收节点
}
