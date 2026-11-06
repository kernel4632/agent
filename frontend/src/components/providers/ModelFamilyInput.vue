<!--
模型族输入：可输入筛选的图标下拉，视觉与模型配置里的上下文输入一致。
调用：<ModelFamilyInput v-model="model.family" :model-id="model.id" :items="familyOptions" />。
-->
<script setup>
import { computed, nextTick, ref, useId, watch } from 'vue'
import Icon from '../../ui/Icon.vue'
import ModelIcon from '../../ui/ModelIcon.vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  modelId: { type: String, default: '' },
  items: { type: Array, default: () => [] },
  label: { type: String, default: '模型族（用于图标）' },
})
const emit = defineEmits(['update:modelValue'])
const open = ref(false)
const searching = ref(false)
const active = ref(0)
const text = ref('')
const input = ref(null)
const id = useId()
const selectedLabel = computed(() => props.items.find(item => item.value === props.modelValue)?.label || props.modelValue || '自动识别')
const filtered = computed(() => {
  if (!searching.value) return props.items
  const query = text.value.trim().toLowerCase()
  if (!query) return props.items
  return props.items.filter(item => `${item.label} ${item.value}`.toLowerCase().includes(query))
})

watch(selectedLabel, label => { if (!searching.value) text.value = label }, { immediate: true })
watch(() => props.modelValue, () => { if (!searching.value) text.value = selectedLabel.value })
watch(filtered, () => { active.value = Math.min(active.value, Math.max(0, filtered.value.length - 1)) })

function focus() {
  open.value = true
  searching.value = false
  text.value = selectedLabel.value
  nextTick(() => input.value?.select())
}

function toggle() {
  if (open.value) { open.value = false; searching.value = false; text.value = selectedLabel.value; return }
  open.value = true
  searching.value = false
  text.value = selectedLabel.value
  nextTick(() => input.value?.focus())
}

function inputText(event) {
  text.value = event.target.value
  searching.value = true
  open.value = true
  active.value = 0
}

function choose(item) {
  emit('update:modelValue', item.value)
  open.value = false
  searching.value = false
  text.value = item.label
}

function blur(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return
  open.value = false
  searching.value = false
  text.value = selectedLabel.value
}

function keydown(event) {
  if (event.key === 'Escape') { open.value = false; searching.value = false; text.value = selectedLabel.value; return }
  if (!open.value) { open.value = true; return }
  if (event.key === 'ArrowDown') { event.preventDefault(); active.value = Math.min(active.value + 1, filtered.value.length - 1) }
  else if (event.key === 'ArrowUp') { event.preventDefault(); active.value = Math.max(active.value - 1, 0) }
  else if (event.key === 'Enter' && filtered.value[active.value]) { event.preventDefault(); choose(filtered.value[active.value]) }
}
</script>

<template>
  <div class="model-family" @focusout="blur">
    <span class="model-family__caption">{{ label }}</span>
    <div class="model-family__control">
      <span class="model-family__leading"><ModelIcon :model="modelId" :family="modelValue" :size="18" /></span>
      <input
        ref="input"
        class="model-family__input"
        role="combobox"
        :aria-label="label"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        :aria-expanded="open"
        :aria-controls="`${id}-options`"
        :value="text"
        placeholder="输入筛选模型族"
        @focus="focus"
        @input="inputText"
        @keydown="keydown"
      />
      <button class="model-family__toggle" type="button" aria-label="展开模型族选项" @click="toggle"><Icon name="down" :size="16" /></button>
      <div v-if="open" :id="`${id}-options`" class="model-family__options" role="listbox" :aria-label="label">
        <button v-for="(item, index) in filtered" :key="item.value" type="button" role="option" :aria-selected="item.value === modelValue" :class="{ 'is-active': index === active }" @mousedown.prevent @click="choose(item)">
          <ModelIcon :model="modelId" :family="item.value" :size="18" />
          <span class="model-family__option-label">{{ item.label }}</span>
          <Icon v-if="item.value === modelValue" name="check" :size="16" />
        </button>
        <p v-if="!filtered.length" class="model-family__empty">没有匹配的模型族</p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/providers/ModelFamilyInput.scss"></style>
