<!-- 标签页：方向键切换并关联面板。示例：<Tabs v-model="tab" :items="tabs"><template #panel="{item}">内容</template></Tabs> -->
<script setup>
import { computed, nextTick, useId } from 'vue'
const props = defineProps({ modelValue: String, items: { type: Array, default: () => [] } })
const emit = defineEmits(['update:modelValue'])
const id = useId()
const selected = computed(() => props.items.find(item => item.value === props.modelValue) || props.items[0])
async function keydown(event, index) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? props.items.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + props.items.length) % props.items.length
  emit('update:modelValue', props.items[next].value)
  await nextTick()
  document.getElementById(`${id}-tab-${next}`)?.focus()
}
</script>
<template>
  <div class="ui-tabs">
    <div class="ui-tabs__list" role="tablist"><button v-for="(item, index) in items" :id="`${id}-tab-${index}`" :key="item.value" type="button" role="tab" :aria-selected="item === selected" :aria-controls="`${id}-panel`" :tabindex="item === selected ? 0 : -1" @click="$emit('update:modelValue', item.value)" @keydown="keydown($event, index)">{{ item.label }}</button></div>
    <Transition name="ui-tab" mode="out-in"><div v-if="selected" :id="`${id}-panel`" :key="selected.value" class="ui-tabs__panel" role="tabpanel" :aria-labelledby="`${id}-tab-${items.indexOf(selected)}`"><slot name="panel" :item="selected" /></div></Transition>
  </div>
</template>
<style scoped lang="scss" src="../styles/ui/Tabs.scss"></style>
