<!--
设置行：左侧标题和说明，右侧操作控件。宽控件可以用 wide 让右侧占更多空间。
调用示例：<SettingsRow title="界面主题" description="选择工作区显示方式"><Select ... /></SettingsRow>
-->
<script setup>
defineProps({ title: String, description: String, wide: Boolean })
</script>

<template>
  <div class="ui-settings-row" :class="{ 'ui-settings-row--wide': wide }">
    <div class="ui-settings-row__copy">
      <span class="ui-settings-row__title"><slot name="title">{{ title }}</slot></span>
      <span v-if="description" class="ui-settings-row__description">{{ description }}</span>
      <slot name="description" />
    </div>
    <div class="ui-settings-row__control"><slot /></div>
  </div>
</template>

<style scoped lang="scss" src="../styles/ui/SettingsRow.scss"></style>
