<!-- 工具设置：渲染工具目录并发出单项配置变化。 -->
<script setup>
import { t } from '../../i18n.js'                                      // 提供工具配置文案
import SelectField from '../fields/SelectField.vue'                   // 使用 M3E 权限选择字段
import TextField from '../fields/TextField.vue'                       // 使用 M3E 工具别名字段
defineProps({ tools: { type: Array, default: () => [] }, titleFor: { type: Function, required: true } })
defineEmits(['update'])                                                // 将字段变化交回设置页 Command
const permissionOptions = [{ value: 'allow', label: 'allow' }, { value: 'ask', label: 'ask' }, { value: 'deny', label: 'deny' }]
</script>

<template>
  <section class="simple-settings">
    <header class="simple-settings__heading"><div><h3>{{ t('tools') }}</h3><p>{{ t('toolsDescription') }}</p></div><span>{{ tools.length }}</span></header>
    <m3e-card v-for="tool in tools" :key="tool.name" class="tool-setting-row">
      <div class="tool-setting-row__layout">
        <m3e-avatar class="tool-setting-row__symbol"><m3e-icon name="build"></m3e-icon></m3e-avatar>
        <div><TextField :model-value="titleFor(tool)" :label="t('toolAlias')" @update:model-value="$emit('update', tool.name, { title: $event })" /><small>{{ tool.name }} · {{ tool.source === '内置' ? t('builtIn') : tool.source }}</small></div>
        <SelectField :model-value="tool.permission" :options="permissionOptions.map((item) => ({ ...item, label: t(item.label) }))" :label="t('toolPermission')" @change="$emit('update', tool.name, { permission: $event })" />
        <m3e-switch :checked="tool.enabled" @change="$emit('update', tool.name, { enabled: $event.target.checked })"></m3e-switch>
      </div>
    </m3e-card>
  </section>
</template>
