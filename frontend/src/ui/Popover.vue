<!-- 锚定信息面板：供会话统计等非菜单内容使用。示例：<Popover label="统计"><template #trigger>打开</template>内容</Popover> -->
<script setup>
import { useId } from 'vue'
import { usePopup } from './usePopup.js'
defineProps({ label: String, contentLabel: String })
const { trigger, popup, open, position, toggle, hide, onToggle } = usePopup({ end: true })
const id = useId()
function escape(event) { event.preventDefault(); event.stopPropagation(); hide(true) }
</script>
<template>
  <span class="ui-popover">
    <button ref="trigger" class="ui-button ui-popover__trigger" type="button" :aria-label="label" :aria-expanded="open" :aria-controls="id" @click="toggle" @keydown.esc="escape"><slot name="trigger" /></button>
    <div :id="id" ref="popup" popover="auto" class="ui-popover__content" role="dialog" :aria-label="contentLabel || label" :style="position" @toggle="onToggle" @keydown.esc="escape"><slot /></div>
  </span>
</template>
<style scoped lang="scss" src="../styles/ui/Popover.scss"></style>
