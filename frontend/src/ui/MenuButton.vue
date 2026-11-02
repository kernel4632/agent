<!-- 行菜单：外点/Escape 关闭，方向键遍历。示例：<MenuButton :items="items" @select="run" /> -->
<script setup>
import { nextTick, useId } from 'vue'
import IconButton from './IconButton.vue'
import AppIcon from './AppIcon.vue'
import { usePopup } from '../utils/popup.js'
const props = defineProps({ label: { type: String, default: '更多操作' }, items: { type: Array, default: () => [] } })
const emit = defineEmits(['select'])
const { trigger, popup, open, position, toggle, hide, onToggle } = usePopup({ end: true })
const id = useId()
async function launch() { toggle(); await nextTick(); popup.value?.querySelector('button:not(:disabled)')?.focus() }
function choose(item) { hide(true); emit('select', item.value) }
function keydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(true); return }
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
  <span class="ui-menu-button">
    <IconButton ref="trigger" class="ui-menu__trigger" :label="label" variant="text" aria-haspopup="menu" :aria-expanded="open" :aria-controls="id" @click="launch" @keydown.down.prevent="launch"><AppIcon name="more" :size="20" /></IconButton>
    <div :id="id" ref="popup" popover="auto" class="ui-menu__popup" role="menu" :aria-label="label" :style="position" @toggle="onToggle" @keydown="keydown">
      <button v-for="item in items" :key="item.value" type="button" role="menuitem" :disabled="item.disabled" @click="choose(item)">{{ item.label }}</button>
    </div>
  </span>
</template>
<style scoped lang="scss" src="../styles/ui/MenuButton.scss"></style>
