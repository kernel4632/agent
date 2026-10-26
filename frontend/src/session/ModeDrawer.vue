<!--
模式切换底部抽屉：和 Roo Code 的角色切换一样，单独入口、单独抽屉，打开就能直接选。
模式列表由 KIMA RadioGroup 渲染；选完立即保存并关闭。
调用示例：<ModeDrawer :open="open" :model-value="session.settings.mode" @select="Session.setMode(session.id, $event)" />
-->
<script setup>
import { computed } from 'vue'
import { KimaRadioGroup } from '@kernel4632/kima'
import { Sheet } from '../ui/index.js'
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
  label: item.readOnly ? `${item.label}（只读）` : item.label,
})))

function choose(value) {
  emit('select', value)
  emit('update:open', false)
}
</script>

<template>
  <Sheet :open="open" label="切换模式" @update:open="emit('update:open', $event)">
    <div class="mode-drawer">
      <p class="mode-drawer__lead">切换后立即保存。计划模式只保留只读工具，避免在思考阶段改文件。</p>
      <KimaRadioGroup
        label="模式"
        :model-value="modelValue"
        :options="options"
        @update:model-value="choose"
      />
    </div>
  </Sheet>
</template>

<style scoped lang="scss">
.mode-drawer { display: grid; max-width: 560px; gap: 16px; margin: 0 auto; padding-bottom: 8px; }
.mode-drawer__lead { margin: 0; color: var(--la-secondary); font-size: 14px; line-height: 22px; }
.mode-drawer :deep(.kima-radio-group__item) { min-height: 56px; }
</style>
