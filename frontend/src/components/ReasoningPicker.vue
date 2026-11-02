<!--
思考强度选择器：输入框旁的灯泡按钮 + 底部弹层，滑块从「关闭」到「最大」共七档。
参考 RikkaHub：按钮图标随档位变化，弹层里用一条滑块和刻度表达「更快 ↔ 更聪明」。
只通过 update:reasoning 交给外面保存；真正的请求参数由后端按协议翻译。
调用示例：<ReasoningPicker :reasoning="session.settings.reasoning" @update:reasoning="saveReasoning" />
-->
<script setup>
import { computed, ref, watch } from 'vue'

import { Icon, Button, Dialog } from '../ui/index.js'
/*
思考强度的七档定义：滑块顺序、中文名、图标和一句说明都在这里。
只负责界面展示；真正发给模型的参数由后端 ../config.js 按协议翻译。
调用示例：import { REASONING_LEVELS, reasoningOf } from './reasoning.js'
*/
const REASONING_LEVELS = [
  { value: 'off', label: '关闭', short: '关', icon: 'thinking-off', hint: '不请求模型思考，回答最快' },
  { value: 'auto', label: '自动', short: '自动', icon: 'thinking-auto', hint: '不额外设置，交给模型自己决定' },
  { value: 'low', label: '轻', short: '轻', icon: 'thinking-low', hint: '适合简单问题，少花一点时间' },
  { value: 'medium', label: '中', short: '中', icon: 'thinking-medium', hint: '日常任务的默认档位' },
  { value: 'high', label: '重', short: '重', icon: 'thinking-high', hint: '复杂问题，允许更长的推理' },
  { value: 'xhigh', label: '极高', short: '极高', icon: 'thinking-xhigh', hint: '长链路任务，思考预算更大' },
  { value: 'max', label: '最大', short: '最大', icon: 'thinking-max', hint: '最慢，也最深入；只留给真正难的问题' },
]

// 找不到时回到 auto，避免旧数据或拼错的值把滑块卡在 0。
const reasoningOf = value => REASONING_LEVELS.find(item => item.value === value) || REASONING_LEVELS[1]
const reasoningIndex = value => Math.max(0, REASONING_LEVELS.findIndex(item => item.value === value))


const props = defineProps({
  reasoning: { type: String, default: 'auto' },
  disabled: Boolean,
})
const emit = defineEmits(['update:reasoning'])

const open = ref(false)
const index = ref(reasoningIndex(props.reasoning))
const current = computed(() => REASONING_LEVELS[index.value] || REASONING_LEVELS[1])
const currentLabel = computed(() => `思考强度：${current.value.label}`)

watch(() => props.reasoning, value => { index.value = reasoningIndex(value) })

// 拖动时只改本地预览，松手才保存；保存失败时父层会把 reasoning 改回去，watch 再把滑块复位。
function commit(value) {
  const level = REASONING_LEVELS[value]
  if (level && level.value !== props.reasoning) emit('update:reasoning', level.value)
}

function setLevel(value) {
  index.value = value
  commit(value)
}
</script>

<template>
  <Button
    variant="plain"
    class="reasoning-option"
    :class="{ 'is-active': reasoning !== 'auto', 'is-off': reasoning === 'off' }"
    :disabled="disabled"
    :aria-label="currentLabel"
    :title="currentLabel"
    @click="open = true"
  >
    <Icon :name="current.icon" :size="24" />
  </Button>

  <Dialog placement="bottom" :open="open" label="思考强度" :width="608" @update:open="open = $event">
    <div class="reasoning-sheet">
      <p class="reasoning-sheet__intro">越往后，模型愿意花越多时间推理；简单问题不需要调到最大。</p>

      <div class="reasoning-hero" :class="{ 'is-off': current.value === 'off' }">
        <span class="reasoning-hero__icon"><Icon :name="current.icon" :size="30" /></span>
        <div>
          <strong>{{ current.label }}</strong>
          <p>{{ current.hint }}</p>
        </div>
      </div>

      <div class="reasoning-scale">
        <div class="reasoning-scale__ends"><span>更快</span><span>更聪明</span></div>
        <input v-model.number="index" type="range" class="ui-slider" :min="0" :max="REASONING_LEVELS.length - 1" :step="1" aria-label="思考强度" :aria-valuetext="current.label" @change="commit(Number($event.target.value))" />
        <div class="reasoning-scale__ticks">
          <Button
            v-for="(level, levelIndex) in REASONING_LEVELS"
            :key="level.value"
            variant="plain"
            class="reasoning-tick"
            :class="{ 'is-active': levelIndex === index }"
            :aria-label="level.label"
            :aria-pressed="levelIndex === index"
            @click="setLevel(levelIndex)"
          >{{ level.short }}</Button>
        </div>
      </div>

      <p class="reasoning-sheet__note">「自动」不改变请求，交给模型默认；只有标记了「推理」能力的模型才会真正收到思考参数。</p>
    </div>
  </Dialog>
</template>

<style scoped lang="scss" src="../styles/components/ReasoningPicker.scss"></style>
