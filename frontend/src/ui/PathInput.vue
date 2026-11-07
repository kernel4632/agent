<!--
路径输入：普通输入框 + 浏览按钮，目录和文件共用。
调用：<PathInput v-model="path" label="目录路径" mode="directory" />。
-->
<script setup>
import { computed, ref } from 'vue'
import Field from './Field.vue'
import Icon from './Icon.vue'
import PathPicker from './PathPicker.vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, default: '' },
  caption: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  mode: { type: String, default: 'directory' },
  initialPath: { type: String, default: '' },
  disabled: Boolean,
  error: { type: String, default: '' },
  clearable: Boolean,
  size: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])
const open = ref(false)
const pickerInitial = computed(() => {
  const path = props.initialPath || props.modelValue
  return /^([a-zA-Z]:[\\/]|\\\\|\/|~[\\/])/.test(path) ? path : ''
})
const title = computed(() => props.mode === 'file' ? '选择文件' : '选择文件夹')
const browseLabel = computed(() => props.mode === 'file' ? '浏览文件' : '浏览目录')

function choose(path) {
  emit('update:modelValue', path)
}
</script>

<template>
  <div class="ui-path-input">
    <Field
      class="ui-path-input__field"
      :label="label"
      :caption="caption"
      :placeholder="placeholder"
      :model-value="modelValue"
      :disabled="disabled"
      :error="error"
      :clearable="clearable"
      :size="size"
      @update:model-value="emit('update:modelValue', $event)"
    >
      <template #trailing>
        <button class="ui-path-input__browse" type="button" :aria-label="browseLabel" :disabled="disabled" @click="open = true">
          <Icon name="folder" :size="16" /><span>浏览</span>
        </button>
      </template>
    </Field>
    <PathPicker :open="open" :mode="mode" :title="title" :initial-path="pickerInitial" @update:open="open = $event" @select="choose" />
  </div>
</template>

<style scoped lang="scss" src="../styles/ui/PathInput.scss"></style>
