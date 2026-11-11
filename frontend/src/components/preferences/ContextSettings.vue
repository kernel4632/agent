<!--
上下文设置页：编辑 config.compact.threshold 和 config.contextKeep，所有会话下一次运行时使用当前值。
字段采用设置列表行：标题和说明在左，滑条和当前值在右。
轮数允许填 0：0 表示压缩后这一段原文一点都不保留，不能当成“没填”退回默认值。
调用示例：<ContextSettings :draft="draft" />
-->
<script setup>
import SettingsList from '../../ui/SettingsList.vue'
import SettingsRow from '../../ui/SettingsRow.vue'
import { COMPACT_RANGE, CONTEXT_KEEP_TURN_MAX } from '../../defaults.js'

const props = defineProps({ draft: { type: Object, required: true } })

function setThreshold(value) {
  const number = Number(value)
  if (Number.isFinite(number) && number >= COMPACT_RANGE.min && number <= COMPACT_RANGE.max) props.draft.compact.threshold = number
}

function setTurns(field, value) {
  const number = Number(value)
  if (Number.isInteger(number) && number >= 0 && number <= CONTEXT_KEEP_TURN_MAX) props.draft.contextKeep[field] = number
}

// 占比按百分数显示，存回 0 到 1 的两位小数，避免滑条拖动产生浮点尾巴。
function setShare(field, value) {
  const number = Number(value)
  if (Number.isFinite(number) && number >= 0 && number <= 1) props.draft.contextKeep[field] = Math.round(number * 100) / 100
}

function turnLabel(turns) {
  return turns > 0 ? `${turns} 轮` : '不留'
}
</script>

<template>
  <section class="context-settings" aria-label="上下文">
    <SettingsList title="自动压缩">
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

    <SettingsList title="压缩后保留的原文">
      <SettingsRow title="开场对话" description="压缩后仍然原样保留最前面几轮对话。0 表示不留，只使用摘要和最近几轮">
        <div class="context-settings__control">
          <input
            class="context-settings__slider"
            type="range"
            min="0"
            :max="CONTEXT_KEEP_TURN_MAX"
            step="1"
            :value="draft.contextKeep.firstTurns"
            aria-label="开场保留轮数"
            @input="setTurns('firstTurns', $event.target.value)"
          />
          <span class="context-settings__value">{{ turnLabel(draft.contextKeep.firstTurns) }}</span>
        </div>
      </SettingsRow>
      <SettingsRow title="最近的对话" description="总结之前保留最近几轮对话的原文，让压缩后还能接着当前话题">
        <div class="context-settings__control">
          <input
            class="context-settings__slider"
            type="range"
            min="0"
            :max="CONTEXT_KEEP_TURN_MAX"
            step="1"
            :value="draft.contextKeep.recentTurns"
            aria-label="最近保留轮数"
            @input="setTurns('recentTurns', $event.target.value)"
          />
          <span class="context-settings__value">{{ turnLabel(draft.contextKeep.recentTurns) }}</span>
        </div>
      </SettingsRow>
      <SettingsRow title="开场预算" description="开场原文最多占多少上下文窗口，超了就少留几轮">
        <div class="context-settings__control">
          <input
            class="context-settings__slider"
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="draft.contextKeep.firstShare"
            aria-label="开场预算"
            @input="setShare('firstShare', $event.target.value)"
          />
          <span class="context-settings__value">{{ Math.round(draft.contextKeep.firstShare * 100) }}%</span>
        </div>
      </SettingsRow>
      <SettingsRow title="最近预算" description="最近原文最多占多少上下文窗口，超了就少留几轮">
        <div class="context-settings__control">
          <input
            class="context-settings__slider"
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="draft.contextKeep.recentShare"
            aria-label="最近预算"
            @input="setShare('recentShare', $event.target.value)"
          />
          <span class="context-settings__value">{{ Math.round(draft.contextKeep.recentShare * 100) }}%</span>
        </div>
      </SettingsRow>
    </SettingsList>
  </section>
</template>

<style scoped lang="scss" src="../../styles/components/preferences/ContextSettings.scss"></style>
