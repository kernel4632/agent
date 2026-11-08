/*
 * 锚定弹层：位置计算交给 @floating-ui/vue，本文件只负责开关、焦点和 Popover API。
 *
 * 以前这里手算 getBoundingClientRect + 翻转，~30 行；边界情况（滚动容器、
 * 视觉视口、方向切换、RTL）都是自己凑的。floating-ui 的 flip / shift / offset
 * 是这类问题的成熟解，而且区分了「布局视口」和「视觉视口」——移动端键盘弹起
 * 把可视区挤小时，手写版本会算错。
 *
 * Popover API 仍然由本文件管理：它负责顶层渲染（不被抽屉或 overflow 裁剪）和
 * 外点关闭，floating-ui 只负责坐标。两者职责不重叠。
 *
 * 调用示例：
 *   const { trigger, popup, open, position, show, hide, toggle, onToggle } = usePopup({ align: 'end' })
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useFloating, offset, flip, shift, size, autoUpdate } from '@floating-ui/vue'

// align → floating-ui 的 placement 前缀。
const PLACEMENT = { start: 'bottom-start', center: 'bottom', end: 'bottom-end' }

export function usePopup({ end = false, align = end ? 'end' : 'start', gap = 8 } = {}) {
  const trigger = ref(null)
  const popup = ref(null)
  const open = ref(false)

  // 触发器可能是组件（$el）也可能是原生元素。
  const reference = computed(() => trigger.value?.$el || trigger.value || null)

  const { floatingStyles } = useFloating(reference, popup, {
    placement: PLACEMENT[align] || PLACEMENT.start,
    middleware: [
      offset(gap),
      // flip：下方放不下就翻到上方
      flip({ padding: 12 }),
      // shift：翻完还溢出就沿着主轴平移，保证整个面板可见
      shift({ padding: 12 }),
      // size：把可用宽度交给 CSS 变量，由样式决定要不要用。
      // 不直接写 minWidth/maxWidth——面板自己的 SCSS 已经定义了宽度规则，
      // 这里硬盖会跟样式表打架（菜单最小 160px，信息面板自适应窄屏）。
      size(({ availableWidth, availableHeight }) => ({
        apply({ elements }) {
          elements.floating.style.setProperty('--popup-available-width', `${availableWidth}px`)
          elements.floating.style.setProperty('--popup-available-height', `${availableHeight}px`)
        },
      })),
    ],
    // 滚动或缩放时重新定位，而不是用一次性坐标
    whileElementsMounted: (...args) => autoUpdate(...args, { animationFrame: false }),
  })

  // 组件期望拿到可以直接绑到 :style 的对象。
  const position = floatingStyles

  async function show() {
    // showPopover 提升到顶层，避免被抽屉或滚动容器裁剪
    popup.value?.showPopover()
    open.value = true
    await nextTick()
  }

  function hide(restore = false) {
    popup.value?.hidePopover()
    open.value = false
    if (restore) (trigger.value?.$el || trigger.value)?.focus()
  }

  function toggle() { if (open.value) hide(); else void show() }

  // popover 自己也会因外点关闭；同步 open 状态，避免按钮按钮的 aria-expanded 和实际不一致。
  function onToggle(event) { open.value = event.newState === 'open' }

  onBeforeUnmount(() => {
    // floating-ui 的 whileElementsMounted 会在元素卸载时自动清 autoUpdate，这里不用手动断。
    popup.value?.hidePopover?.()
  })

  return { trigger, popup, open, position, show, hide, toggle, onToggle }
}
