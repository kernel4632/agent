<!--
上下文设置页：编辑 config.compact.threshold，所有会话下一次运行时使用当前值。
字段采用设置列表行：标题和说明在左，滑条和当前百分比在右。
调用示例：<ContextSettings :draft="draft" />
-->
<script setup>
import SettingsList from '../../ui/SettingsList.vue'
import SettingsRow from '../../ui/SettingsRow.vue'
import { COMPACT_RANGE } from '../../defaults.js'

const props = defineProps({ draft: { type: Object, required: true } })

function setThreshold(value) {
  const number = Number(value)
  if (Number.isFinite(number) && number >= COMPACT_RANGE.min && number <= COMPACT_RANGE.max) props.draft.compact.threshold = number
}
</script>

<template>
  <section class="context-settings" aria-label="上下文">
    <SettingsList title="上下文">
      <SettingsRow title="自动压缩阈值" description="上下文用到这个比例时，先把较早的对话总结成摘要，再继续回答">
        <div class="context-settings__control">
          <input
            class="context-settings__slider"
            type="range"
            :min="COMPACT_RANGE.min"
            :max="COMPACT_RANGE.max"
            step="0.01"
            :value="draft.compact.threshold"
            aria-label="自动压缩阈值"
            @input="setThreshold($event.target.value)"
          />
          <span class="context-settings__value">{{ Math.round(draft.compact.threshold * 100) }}%</span>
        </div>
      </SettingsRow>
    </SettingsList>
  </section>
</template>

<style scoped lang="scss" src="../../styles/components/preferences/ContextSettings.scss"></style>
