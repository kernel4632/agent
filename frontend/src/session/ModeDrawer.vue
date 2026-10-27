<!--
模式切换底部抽屉：和 Roo Code 的角色切换一样，单独入口、单独抽屉，打开就能直接选。
选项交给 KIMA RadioGroup，单选、方向键和 ARIA 都由组件负责；每行内容用 #option 插槽画成卡片。
调用示例：<ModeDrawer :open="open" :model-value="session.settings.mode" @select="Session.setMode(session.id, $event)" />
-->
<script setup>
import { computed } from 'vue'
import { KimaRadioGroup } from '@kernel4632/kima'
import { ChoiceContent, Sheet } from '../ui/index.js'
import { store } from '../store.js'

const props = defineProps({
  open: Boolean,
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:open', 'select'])

const modes = computed(() => store.config.modes?.length ? store.config.modes : [
  { name: 'build', label: '执行模式', readOnly: false },
  { name: 'plan', label: '计划模式', readOnly: true },
])
const options = computed(() => modes.value.map(item => ({
  value: item.name,
  label: item.label,
  description: item.readOnly ? '只读工具，先看清再动手' : '可以改文件、执行命令',
  icon: item.readOnly ? 'eye' : 'code',
})))

function choose(value) {
  emit('select', value)
  emit('update:open', false)
}
</script>

<template>
  <Sheet
    :open="open"
    label="切换模式"
    description="选一个现在要用的模式，选完立即保存。"
    :width="608"
    @update:open="emit('update:open', $event)"
  >
    <div class="mode-drawer">
      <KimaRadioGroup
        label="模式"
        :model-value="modelValue"
        :options="options"
        @update:model-value="choose"
      >
        <template #option="{ item, selected }">
          <ChoiceContent
            :selected="selected"
            :show-mark="false"
            :icon="item.icon"
            :title="item.label"
            :hint="item.description"
          />
        </template>
      </KimaRadioGroup>
    </div>
  </Sheet>
</template>

<style scoped lang="scss">
.mode-drawer { width: 100%; max-width: 560px; margin: 16px auto 0; padding-bottom: 8px; }

.mode-drawer :deep(.kima-radio-group) { gap: 8px; }

/* 每一行都当成卡片：底色和描边由这里负责，图标、文字和单选圆点由 ChoiceContent 与原生 input 负责。 */
.mode-drawer :deep(.kima-radio-group__item) {
  min-height: 68px;
  padding: 12px 16px;
  gap: 14px;
  border: 1px solid transparent;
  border-radius: 16px;
  background: var(--la-layer-01);
  color: var(--la-text);
  transition:
    background-color var(--kima-duration-medium) var(--kima-curve-standard),
    border-color var(--kima-duration-medium) var(--kima-curve-standard);
}

.mode-drawer :deep(.kima-radio-group__item:hover) {
  border-color: var(--la-line);
  background: var(--la-layer-02);
}

.mode-drawer :deep(.kima-radio-group__item:has(input:checked)) {
  border-color: var(--la-accent-border);
  background: color-mix(in srgb, var(--la-accent) 9%, var(--la-layer-01));
  color: var(--la-text);
}

.mode-drawer :deep(.kima-radio-group__item:has(input:checked):hover) {
  background: color-mix(in srgb, var(--la-accent) 13%, var(--la-layer-01));
}

/* 原生单选框留在 DOM 里负责语义和键盘；视觉上排到行尾，代替手画的勾选圈。 */
.mode-drawer :deep(.kima-radio-group__item > input) {
  order: 3;
  margin-inline-start: auto;
}

@media (max-width: 360px) {
  .mode-drawer :deep(.kima-radio-group__item) { padding: 11px 13px; gap: 11px; }
}
</style>
