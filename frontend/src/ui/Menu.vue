<!-- 锚定浮层：共享定位、外点关闭和焦点归还；菜单模式负责方向键，内容模式显示面板。
示例：<Menu :items="items" @select="run" />；<Menu mode="content" label="统计"><template #trigger>打开</template>内容</Menu>。
-->
<script setup>
import { nextTick, useId } from 'vue'
import Button from './Button.vue'
import Icon from './Icon.vue'
import { usePopup } from '../utils/popup.js'
const props = defineProps({ mode: { type: String, default: 'menu' }, label: { type: String, default: '更多操作' }, contentLabel: String, contentClass: String, contentStyle: Object, items: { type: Array, default: () => [] } })
const emit = defineEmits(['select'])
const { trigger, popup, open, position, toggle, hide, onToggle } = usePopup({ end: true, align: props.mode === 'content' ? 'center' : 'end' })
const id = useId()
async function launch() {
  toggle()
  if (props.mode === 'content' || !open.value) return // 内容面板保留触发器焦点
  await nextTick()
  popup.value?.querySelector('button:not(:disabled)')?.focus()
}
function choose(item) { hide(true); emit('select', item.value) }
function keydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(true); return }
  if (props.mode === 'content') return
  if (event.key === 'Tab') { hide(); return }
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = [...popup.value.querySelectorAll('button:not(:disabled)')]
  const index = items.indexOf(document.activeElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
  items[next]?.focus()
}
</script>
<template>
  <span :class="mode === 'content' ? 'ui-popover' : 'ui-menu-button'">
    <button v-if="mode === 'content'" ref="trigger" class="ui-button ui-popover__trigger" type="button" :aria-label="label" :aria-expanded="open" :aria-controls="id" @click="launch" @keydown.esc="keydown"><slot name="trigger" /></button>
    <Button v-else ref="trigger" icon class="ui-menu__trigger" :label="label" variant="text" aria-haspopup="menu" :aria-expanded="open" :aria-controls="id" @click="launch" @keydown.down.prevent="launch"><Icon name="more" :size="20" /></Button>
    <div :id="id" ref="popup" popover="auto" :class="[mode === 'content' ? 'ui-popover__content' : 'ui-menu__popup', contentClass]" :role="mode === 'content' ? 'dialog' : 'menu'" :aria-label="contentLabel || label" :style="[position, contentStyle]" @toggle="onToggle" @keydown="keydown">
      <!-- 内容只在打开时挂载：长会话的统计面板不参与流式渲染，关闭后也不占渲染成本。 -->
      <slot v-if="mode === 'content' && open" />
      <template v-if="mode !== 'content'"><button v-for="item in items" :key="item.value" type="button" role="menuitem" :disabled="item.disabled" @click="choose(item)">{{ item.label }}</button></template>
    </div>
  </span>
</template>
<style scoped lang="scss" src="../styles/ui/Menu.scss"></style>
