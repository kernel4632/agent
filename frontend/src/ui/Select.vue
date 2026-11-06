<!-- 下拉选择：单一组合框、方向键、首尾键与字符搜索。示例：<Select v-model="color" :items="colors" label="颜色" /> -->
<script setup>
import { computed, nextTick, ref, useId } from 'vue'
import Icon from './Icon.vue'
import { usePopup } from '../utils/popup.js'
const props = defineProps({ modelValue: [String, Number], items: { type: Array, default: () => [] }, label: String, placeholder: { type: String, default: '请选择' }, disabled: Boolean })
const emit = defineEmits(['update:modelValue'])
const { trigger, popup, open, position, show, hide, toggle, onToggle } = usePopup()
const id = useId()
const active = ref(0)
const selected = computed(() => props.items.find(item => item.value === props.modelValue))
function choose(item) { if (item.disabled) return; emit('update:modelValue', item.value); hide(true) }
async function keydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(true); return }
  if (event.key === 'Tab') { hide(); return }
  if (['Enter', ' '].includes(event.key)) {
    event.preventDefault()
    if (open.value && props.items[active.value]) choose(props.items[active.value])
    else if (props.items.length) await show()
    return
  }
  const enabled = props.items.map((item, index) => item.disabled ? -1 : index).filter(index => index >= 0)
  if (!enabled.length) return
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    if (!open.value) await show()
    const step = event.key === 'ArrowUp' ? -1 : 1
    active.value = event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1) : enabled[(enabled.indexOf(active.value) + step + enabled.length) % enabled.length]
  } else if (event.key.length === 1) {
    event.stopPropagation() // 字符搜索不能触发页面的 N 新建会话快捷键
    const index = props.items.findIndex(item => !item.disabled && item.label.toLowerCase().startsWith(event.key.toLowerCase()))
    if (index < 0) return
    active.value = index
    if (!open.value) emit('update:modelValue', props.items[index].value)
  }
  await nextTick()
  document.getElementById(`${id}-${active.value}`)?.scrollIntoView({ block: 'nearest' })
}
function click() { active.value = Math.max(0, props.items.findIndex(item => item.value === props.modelValue)); toggle() }
</script>
<template>
  <div class="ui-select">
    <button ref="trigger" type="button" class="ui-select__trigger" role="combobox" :aria-label="label" aria-haspopup="listbox" :aria-controls="id" :aria-expanded="open" :aria-activedescendant="open ? `${id}-${active}` : undefined" :disabled="disabled || !items.length" @click="click" @keydown="keydown"><span class="ui-select__value"><slot name="selected" :item="selected">{{ selected?.label || placeholder }}</slot></span><Icon name="down" :size="20" /></button>
    <div :id="id" ref="popup" popover="auto" class="ui-select__options" role="listbox" :aria-label="label" :style="position" @toggle="onToggle">
      <button v-for="(item, index) in items" :id="`${id}-${index}`" :key="item.value" type="button" role="option" tabindex="-1" :aria-selected="modelValue === item.value" :disabled="item.disabled" :class="{ 'is-active': index === active }" @pointerdown.prevent @click="choose(item)"><span class="ui-select__option"><slot name="option" :item="item" :selected="modelValue === item.value">{{ item.label }}</slot></span><Icon v-if="modelValue === item.value" name="check" :size="18" /></button>
    </div>
  </div>
</template>
<style scoped lang="scss" src="../styles/ui/Select.scss"></style>
