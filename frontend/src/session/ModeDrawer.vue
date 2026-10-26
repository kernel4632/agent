<!--
模式切换底部抽屉：和 Roo Code 的角色切换一样，单独入口、单独抽屉，打开就能直接选。
列表沿用自动批准那边的卡片样式；选完立即保存并关闭。
调用示例：<ModeDrawer :open="open" :model-value="session.settings.mode" @select="Session.setMode(session.id, $event)" />
-->
<script setup>
import { computed } from 'vue'
import { KimaList } from '@kernel4632/kima'
import { ChoiceCard, Sheet } from '../ui/index.js'
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
const rows = computed(() => modes.value.map(item => ({
  id: item.name,
  icon: item.readOnly ? 'eye' : 'code',
  title: item.label,
  hint: item.readOnly ? '只保留只读工具，先看清再动手' : '可以改文件、执行命令',
  on: item.name === props.modelValue,
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
    <div class="mode-drawer" role="radiogroup" aria-label="模式">
      <KimaList class="mode-drawer__list" :items="rows" label="模式">
        <template #item="{ item }">
          <ChoiceCard
            role="radio"
            :selected="item.on"
            :icon="item.icon"
            :title="item.title"
            :hint="item.hint"
            @select="choose(item.id)"
          />
        </template>
      </KimaList>
    </div>
  </Sheet>
</template>

<style scoped lang="scss">
.mode-drawer { display: grid; width: 100%; max-width: 560px; gap: 14px; margin: 0 auto; padding-bottom: 8px; }

/* KIMA 列表默认带 20px 行内边距和底色；这里把行还原成透明，
   圆角、底色和点击面都交给里面的 ChoiceCard。 */
.mode-drawer__list :deep(.kima-list) { gap: 8px; }
.mode-drawer__list :deep(.kima-list__item) {
  min-height: 0;
  padding: 0;
  border-radius: 16px;
  background: transparent;
}
</style>
