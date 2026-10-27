/*
 * 平滑文字：把模型一次推来的一大段文字，按小步追到最新内容。
 * 只负责“显示到哪”，不解析 Markdown；避免每个 SSE 分片都整段替换，看起来一顿一顿的。
 * 历史文本初始化时就是全文，不会重播动画；只有流式增长时才逐帧追。
 * 调用示例：const { text, done } = useSmoothText(computed(() => message.content))
 */
import { onBeforeUnmount, ref, watch } from 'vue'

export function useSmoothText(source) {
  const text = ref(String(source.value ?? ''))
  const done = ref(true)
  let frame = 0
  let last = 0

  function run(now) {
    const target = String(source.value ?? '')
    if (target.length <= text.value.length) {
      if (text.value !== target) text.value = target
      done.value = true
      frame = 0
      return
    }
    done.value = false
    if (now - last >= 40) {
      const remaining = target.length - text.value.length
      // 离目标越远走得越快，既有逐字感，又不会在长回复里落后太多。
      const take = Math.max(1, Math.ceil(remaining * 0.18))
      text.value = target.slice(0, text.value.length + take)
      last = now
    }
    frame = requestAnimationFrame(run)
  }

  function kick() {
    if (frame) return
    const target = String(source.value ?? '')
    if (target.length <= text.value.length) {
      text.value = target
      done.value = true
      return
    }
    done.value = false
    last = 0
    frame = requestAnimationFrame(run)
  }

  watch(source, target => {
    const next = String(target ?? '')
    if (next.length < text.value.length) {
      // 回退、重试或切换会话时直接追上，不能倒着播放。
      text.value = next
      done.value = true
      return
    }
    kick()
  })

  onBeforeUnmount(() => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  })

  return { text, done }
}
