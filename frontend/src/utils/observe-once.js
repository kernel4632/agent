/*
 * 进入视口才做某事的观察器：给长会话里的重内容（图表、大段代码）用。
 * 内容一旦进入过视口就不再取消观察——用户往回滚时不能又变回占位。
 *
 * 调用示例：
 *   const stop = observeOnce(element, () => render())
 *   stop()   // 组件卸载时断开
 */
export function observeOnce(element, callback, { rootMargin = '400px' } = {}) {
  if (!element) return () => {}

  // 没有 IntersectionObserver（老浏览器、测试环境）时直接执行，不能把内容永远卡在占位。
  if (typeof IntersectionObserver === 'undefined') {
    callback()
    return () => {}
  }

  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return
    observer.disconnect()   // 只触发一次：渲染过的内容不会因为滚走而消失
    callback()
  }, { rootMargin })         // 提前一屏开始渲染，滚动到时已经画好

  observer.observe(element)
  return () => observer.disconnect()
}
