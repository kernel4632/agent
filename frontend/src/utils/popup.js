/* 锚定弹层：原生 Menu API 提供顶层与外点关闭；Select/Menu/Menu 调用 usePopup()。 */
import { nextTick, onBeforeUnmount, ref } from 'vue'
export function usePopup({ end = false } = {}) {
  const trigger = ref(null)
  const popup = ref(null)
  const open = ref(false)
  const position = ref({})
  function place() {
    const anchor = trigger.value?.$el || trigger.value
    if (!anchor || !popup.value) return
    const box = anchor.getBoundingClientRect()
    const width = Math.min(Math.max(popup.value.offsetWidth, box.width), innerWidth - 24)
    const left = Math.max(12, Math.min(end ? box.right - width : box.left, innerWidth - width - 12))
    const height = popup.value.offsetHeight
    const top = box.bottom + height + 8 > innerHeight ? Math.max(12, box.top - height - 8) : box.bottom + 8
    position.value = { left: `${left}px`, top: `${top}px`, minWidth: `${box.width}px` }
  }
  async function show() {
    popup.value.showPopover() // 提升到顶层，避免被抽屉或滚动容器裁剪
    open.value = true
    await nextTick()
    place()
  }
  function hide(restore = false) {
    popup.value?.hidePopover()
    open.value = false
    if (restore) (trigger.value?.$el || trigger.value)?.focus()
  }
  function toggle() { if (open.value) hide(); else show() }
  function onToggle(event) { open.value = event.newState === 'open' }
  window.addEventListener('resize', place)
  window.addEventListener('scroll', place, true)
  onBeforeUnmount(() => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) })
  return { trigger, popup, open, position, show, hide, toggle, onToggle }
}
