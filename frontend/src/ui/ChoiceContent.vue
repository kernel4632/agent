<!--
选项内容：图标块、名称、说明和右侧勾选标记，只负责显示，不接管点击。
自动批准把它放进 KimaListbox 的 #option，模式把它放进 KimaRadioGroup 的 #option；
选中状态、键盘和 ARIA 都由 KIMA 负责。
调用示例：<ChoiceContent :selected="on" icon="eye" title="读取" hint="读文件、搜索不用再问" />
-->
<script setup>
import AppIcon from './AppIcon.vue'

defineProps({
  selected: Boolean,
  icon: { type: String, default: 'spark' },
  title: { type: String, default: '' },
  hint: { type: String, default: '' },
  showMark: { type: Boolean, default: true },
})
</script>

<template>
  <span class="choice-content" :class="{ 'is-selected': selected }">
    <span class="choice-content__icon" aria-hidden="true"><AppIcon :name="icon" :size="20" /></span>
    <span class="choice-content__copy">
      <strong>{{ title }}</strong>
      <small v-if="hint">{{ hint }}</small>
    </span>
    <span v-if="showMark" class="choice-content__mark" :class="{ 'is-selected': selected }" aria-hidden="true">
      <AppIcon v-if="selected" name="check" :size="15" />
    </span>
  </span>
</template>

<style scoped lang="scss">
.choice-content {
  display: flex;
  width: 100%;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 14px;
}

.choice-content__icon {
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

.choice-content.is-selected .choice-content__icon {
  background: color-mix(in srgb, var(--la-accent) 15%, transparent);
  color: var(--la-accent);
}

.choice-content__copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.choice-content__copy strong {
  overflow: hidden;
  color: var(--la-text);
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-content.is-selected .choice-content__copy strong { color: var(--la-accent); }

.choice-content__copy small {
  color: var(--la-secondary);
  font-size: 12.5px;
  line-height: 18px;
}

.choice-content__mark {
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

.choice-content__mark.is-selected {
  border-color: var(--la-accent-solid);
  background: var(--la-accent-solid);
  color: var(--la-on-accent);
}

@media (max-width: 360px) {
  .choice-content { gap: 11px; }
  .choice-content__icon { width: 36px; height: 36px; border-radius: 10px; }
  .choice-content__copy strong { font-size: 14.5px; }
}
</style>
