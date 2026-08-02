<!--
工具管理：展示每个工具的别名、权限和启用状态。
组件只反馈字段变化，设置指令负责修改草稿。
调用示例：<ToolSettings :tools="tools" @update="Settings.updateTool" />
-->
<script setup>
import { t } from '../../i18n.js'                                      // 提供工具配置文案
import SelectField from '../shared/SelectField.vue'                   // 使用 M3E 权限选择字段
import TextField from '../shared/TextField.vue'                       // 使用 M3E 工具别名字段
defineProps({ tools: { type: Array, default: () => [] }, titleFor: { type: Function, required: true } })
defineEmits(['update'])                                                // 将字段变化交回设置页 Command
const permissionOptions = [{ value: 'allow', label: 'allow' }, { value: 'ask', label: 'ask' }, { value: 'deny', label: 'deny' }]
</script>

<template>
  <section class="simple-settings">
    <header class="simple-settings__heading"><h3>{{ t('tools') }}</h3></header>
    <m3e-card v-for="tool in tools" :key="tool.name" class="tool-setting-row">
      <div class="tool-setting-row__layout">
        <div><TextField :model-value="titleFor(tool)" :label="t('toolAlias')" @update:model-value="$emit('update', tool.name, { title: $event })" /><small>{{ tool.name }} · {{ tool.source === '内置' ? t('builtIn') : tool.source }}</small></div>
        <SelectField :model-value="tool.permission" :options="permissionOptions.map((item) => ({ ...item, label: t(item.label) }))" :label="t('toolPermission')" @change="$emit('update', tool.name, { permission: $event })" />
        <m3e-switch :checked="tool.enabled" @change="$emit('update', tool.name, { enabled: $event.target.checked })"></m3e-switch>
      </div>
    </m3e-card>
  </section>
</template>
