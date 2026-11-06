<!--
设置分组卡片：左侧标题和说明、右侧控件的一组行共用同一张卡片。
调用示例：<SettingsList title="外观"><SettingsRow ... /></SettingsList>
-->
<script setup>
defineProps({ title: String })
</script>

<template>
  <section class="ui-settings-list">
    <h2 v-if="title" class="ui-settings-list__title">{{ title }}</h2>
    <div class="ui-settings-list__card"><slot /></div>
  </section>
</template>

<style scoped lang="scss" src="../styles/ui/SettingsList.scss"></style>
