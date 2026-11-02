<!--
选项内容：图标块、名称、说明和右侧勾选标记，只负责显示，不接管点击。
自动批准把它放进 KimaListbox 的 #option，智能体把它放进 KimaRadioGroup 的 #option；
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

<style scoped lang="scss" src="../styles/ui/ChoiceContent.scss"></style>
