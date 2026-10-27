<!--
上下文设置页：自动压缩阈值等全局默认值。
这里保存的是新对话的默认值；已有对话保留自己的设置。
调用示例：<ContextPage :draft="draft" />
-->
<script setup>
import { Field } from '../../ui/index.js'
import { COMPACT_RANGE, DEFAULT_SETTINGS } from '../../commands/defaults.js'

const props = defineProps({ draft: { type: Object, required: true } })

function setThreshold(value) {
  const number = Number(value)
  if (Number.isFinite(number) && number >= COMPACT_RANGE.min && number <= COMPACT_RANGE.max) props.draft.compactThreshold = number
}
</script>

<template>
  <section class="context-settings" aria-label="上下文">
    <header class="context-settings__head">
      <p>控制新对话在上下文快满时如何自动总结。压缩只读取历史，不会改动项目文件。</p>
    </header>

    <div class="context-settings__section">
      <div class="context-settings__copy">
        <h3>自动压缩阈值</h3>
        <p>上下文用到这个比例时，先把较早的对话总结成一段摘要，再继续回答。范围 0.1 到 0.99。</p>
      </div>
      <Field
        size="small"
        caption="阈值"
        type="number"
        label="阈值"
        min="0.1"
        max="0.99"
        step="0.05"
        :model-value="draft.compactThreshold ?? DEFAULT_SETTINGS.compactThreshold"
        @change="setThreshold"
      />
      <p class="context-settings__hint">当前：{{ Math.round((draft.compactThreshold ?? DEFAULT_SETTINGS.compactThreshold) * 100) }}%。越接近 1，留给摘要和回答的空间越少。</p>
    </div>
  </section>
</template>

<style scoped lang="scss">
.context-settings { display: flex; flex-direction: column; gap: 20px; }
.context-settings__head p { margin: 0; color: var(--la-muted); font-size: 14px; line-height: 22px; }
.context-settings__section {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px;
  border-radius: 20px;
  background: var(--la-layer-01);
}
.context-settings__copy { display: flex; flex-direction: column; gap: 6px; }
.context-settings__copy h3 { margin: 0; color: var(--la-text); font-size: 16px; font-weight: 600; line-height: 24px; }
.context-settings__copy p { margin: 0; color: var(--la-muted); font-size: 13px; line-height: 20px; }
.context-settings__hint { margin: 0; color: var(--la-muted); font-size: 12.5px; line-height: 18px; }
@media (max-width: 767px) {
  .context-settings__section { padding: 18px; }
}
</style>
