<!-- JSON 草稿：保留未完成输入，完整对象才发 change。示例：<JsonInput :model-value="headers" @change="save" /> -->
<script setup>
import { ref, watch } from 'vue'
import Field from './Field.vue'
const props = defineProps({ modelValue: { type: String, default: '' }, label: String, rows: { type: Number, default: 4 } })
const emit = defineEmits(['change'])
const text = ref(props.modelValue)
const error = ref('')
watch(() => props.modelValue, value => { text.value = value; error.value = '' })
function input(value) {
  text.value = value
  error.value = ''
  if (!value.trim()) { emit('change', ''); return }
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { error.value = '请填写 JSON 对象'; return }
    emit('change', value)
  } catch (problem) { error.value = `JSON 尚未完整：${problem.message}` }
}
</script>
<template><Field class="ui-json-input" multiline :model-value="text" :label="label" :rows="rows" :error="error" spellcheck="false" @update:model-value="input" /></template>
<style scoped lang="scss" src="../styles/ui/JsonInput.scss"></style>
