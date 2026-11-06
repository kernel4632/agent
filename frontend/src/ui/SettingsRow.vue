<!--
设置行：左侧标题和说明，右侧操作控件。高控件用 wide 改为上下布局，避免左侧留大片空白。
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
