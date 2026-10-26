<!--
选项卡片：底部抽屉里一行一个可选项，图标、名称、说明和选中标记都在同一块里。
role 交给调用方：自动批准用 checkbox，模式用 radio；点击和键盘焦点都由原生 button 提供。
调用示例：<ChoiceCard role="checkbox" :selected="on" icon="eye" title="读取" hint="查看文件和目录" @select="toggle" />
-->
<script setup>
import AppIcon from './AppIcon.vue'

defineProps({
  role: { type: String, default: 'checkbox' },
  selected: Boolean,
  icon: { type: String, default: 'spark' },
  title: { type: String, default: '' },
  hint: { type: String, default: '' },
})
const emit = defineEmits(['select'])
</script>

<template>
  <button
    type="button"
    :role="role"
    :aria-checked="selected"
    class="choice-card"
    :class="{ 'is-selected': selected }"
    @click="emit('select')"
  >
    <span class="choice-card__icon" aria-hidden="true"><AppIcon :name="icon" :size="20" /></span>
    <span class="choice-card__copy">
      <strong>{{ title }}</strong>
      <small v-if="hint">{{ hint }}</small>
    </span>
    <span class="choice-card__mark" aria-hidden="true">
      <AppIcon v-if="selected" name="check" :size="15" />
    </span>
  </button>
</template>

<style scoped lang="scss">
.choice-card {
  display: flex;
  width: 100%;
  min-height: 68px;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border: 1px solid transparent;
  border-radius: 16px;
  background: var(--la-layer-01);
  color: var(--la-text);
  font-family: var(--la-font-sans);
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--kima-duration-medium) var(--kima-curve-standard),
    border-color var(--kima-duration-medium) var(--kima-curve-standard);

  &:hover:not(:disabled) {
    border-color: var(--la-line);
    background: var(--la-layer-02);
  }

  &:focus-visible {
    outline: 2px solid var(--la-accent);
    outline-offset: 2px;
  }

  &.is-selected {
    border-color: var(--la-accent-border);
    background: color-mix(in srgb, var(--la-accent) 9%, var(--la-layer-01));
  }

  &.is-selected:hover:not(:disabled) {
    background: color-mix(in srgb, var(--la-accent) 13%, var(--la-layer-01));
  }
}

.choice-card__icon {
  display: flex;
  width: 40px;
  height: 40px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--la-layer-02);
  color: var(--la-secondary);
  transition:
    background-color var(--kima-duration-medium) var(--kima-curve-standard),
    color var(--kima-duration-medium) var(--kima-curve-standard);
}

.choice-card.is-selected .choice-card__icon {
  background: color-mix(in srgb, var(--la-accent) 15%, transparent);
  color: var(--la-accent);
}

.choice-card__copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.choice-card__copy strong {
  overflow: hidden;
  color: var(--la-text);
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-card.is-selected .choice-card__copy strong {
  color: var(--la-accent);
}

.choice-card__copy small {
  color: var(--la-secondary);
  font-size: 12.5px;
  line-height: 18px;
}

.choice-card__mark {
  display: flex;
  width: 22px;
  height: 22px;
  flex: none;
  align-items: center;
  justify-content: center;
  border: 1.5px solid var(--la-line-strong);
  border-radius: 50%;
  color: transparent;
  transition:
    background-color var(--kima-duration-medium) var(--kima-curve-standard),
    border-color var(--kima-duration-medium) var(--kima-curve-standard);
}

.choice-card.is-selected .choice-card__mark {
  border-color: var(--la-accent-solid);
  background: var(--la-accent-solid);
  color: var(--la-on-accent);
}

@media (max-width: 360px) {
  .choice-card { gap: 11px; padding: 11px 13px; }
  .choice-card__icon { width: 36px; height: 36px; border-radius: 10px; }
  .choice-card__copy strong { font-size: 14.5px; }
}
</style>
