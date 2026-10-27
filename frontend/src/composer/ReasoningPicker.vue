<!--
思考强度选择器：输入框旁的灯泡按钮 + 底部弹层，滑块从「关闭」到「最大」共七档。
参考 RikkaHub：按钮图标随档位变化，弹层里用一条滑块和刻度表达「更快 ↔ 更聪明」。
只通过 update:reasoning 交给外面保存；真正的请求参数由后端按协议翻译。
调用示例：<ReasoningPicker :reasoning="session.settings.reasoning" @update:reasoning="saveReasoning" />
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { KimaSlider } from '@kernel4632/kima'
import { AppIcon, Button, Sheet } from '../ui/index.js'
import { REASONING_LEVELS, reasoningIndex } from './reasoning.js'

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
    <AppIcon :name="current.icon" :size="24" />
  </Button>

  <Sheet :open="open" label="思考强度" :width="608" @update:open="open = $event">
    <div class="reasoning-sheet">
      <p class="reasoning-sheet__intro">越往后，模型愿意花越多时间推理；简单问题不需要调到最大。</p>

      <div class="reasoning-hero" :class="{ 'is-off': current.value === 'off' }">
        <span class="reasoning-hero__icon"><AppIcon :name="current.icon" :size="30" /></span>
        <div>
          <strong>{{ current.label }}</strong>
          <p>{{ current.hint }}</p>
        </div>
      </div>

      <div class="reasoning-scale">
        <div class="reasoning-scale__ends"><span>更快</span><span>更聪明</span></div>
        <KimaSlider
          v-model="index"
          :min="0"
          :max="REASONING_LEVELS.length - 1"
          :step="1"
          label="思考强度"
          :aria-valuetext="current.label"
          @change="commit"
        />
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
  </Sheet>
</template>

<style scoped lang="scss">
.reasoning-option {
  display: grid;
  width: 48px;
  height: 48px;
  flex: none;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--la-muted);
  cursor: pointer;
}
.reasoning-option:hover:not(:disabled) { background: var(--la-hover); color: var(--la-text); }
.reasoning-option.is-active { color: var(--la-accent); background: var(--la-accent-soft); }
.reasoning-option.is-off { opacity: .62; }
.reasoning-option:disabled { opacity: .38; cursor: default; }

.reasoning-sheet { display: grid; gap: 18px; padding-bottom: 8px; }
.reasoning-sheet__intro { margin: 0; color: var(--la-muted); font-size: 13.5px; line-height: 21px; }
.reasoning-hero {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px;
  border-radius: 20px;
  background: var(--la-accent-soft);
  color: var(--la-text);
}
.reasoning-hero.is-off { background: var(--la-layer-02); }
.reasoning-hero__icon {
  display: grid;
  width: 52px;
  height: 52px;
  flex: none;
  place-items: center;
  border-radius: 16px;
  background: color-mix(in srgb, var(--la-accent) 18%, transparent);
  color: var(--la-accent);
}
.reasoning-hero.is-off .reasoning-hero__icon { background: var(--la-layer-03); color: var(--la-muted); }
.reasoning-hero strong { display: block; font-size: 18px; font-weight: 600; line-height: 26px; }
.reasoning-hero p { margin: 2px 0 0; color: var(--la-muted); font-size: 13px; line-height: 20px; }
.reasoning-scale { display: grid; gap: 6px; }
.reasoning-scale__ends { display: flex; justify-content: space-between; color: var(--la-muted); font-size: 12.5px; line-height: 18px; }
.reasoning-scale__ticks { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
.reasoning-tick {
  min-width: 0;
  min-height: 32px;
  padding: 0 2px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--la-muted);
  font-size: 12px;
  cursor: pointer;
}
.reasoning-tick:hover { background: var(--la-hover); color: var(--la-text); }
.reasoning-tick.is-active { color: var(--la-accent); background: var(--la-accent-soft); font-weight: 600; }
.reasoning-sheet__note { margin: 0; color: var(--la-muted); font-size: 12.5px; line-height: 19px; }
@media (max-width: 767px) {
  .reasoning-option { width: 44px; height: 44px; }
  .reasoning-tick { font-size: 11px; }
}
@media (max-width: 360px) {
  .reasoning-option { width: 40px; height: 40px; }
}
</style>
