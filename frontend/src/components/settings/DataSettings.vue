<!-- 数据设置：展示导入、导出和清理命令，并反馈最近结果。 -->
<script setup>
import { t } from '../../i18n.js'                                      // 提供数据管理动作文案
defineProps({ feedback: { type: String, default: '' } })
defineEmits(['action'])                                                // 将数据动作交回 Command
</script>

<template>
  <section class="simple-settings data-settings">
    <header class="simple-settings__heading"><div><h3>{{ t('dataManagement') }}</h3><p>{{ t('dataDescription') }}</p></div></header>
    <m3e-card><div class="data-setting-row"><m3e-avatar><m3e-icon name="download"></m3e-icon></m3e-avatar><div><strong>{{ t('exportData') }}</strong><small>{{ t('exportDescription') }}</small></div><m3e-button @click="$emit('action', 'export')">{{ t('export') }}</m3e-button></div></m3e-card>
    <m3e-card><div class="data-setting-row"><m3e-avatar><m3e-icon name="upload"></m3e-icon></m3e-avatar><div><strong>{{ t('importData') }}</strong><small>{{ t('importDescription') }}</small></div><m3e-button @click="$emit('action', 'import')">{{ t('import') }}</m3e-button></div></m3e-card>
    <m3e-card class="is-danger"><div class="data-setting-row"><m3e-avatar><m3e-icon name="delete"></m3e-icon></m3e-avatar><div><strong>{{ t('clearData') }}</strong><small>{{ t('clearDescription') }}</small></div><m3e-button @click="$emit('action', 'clear')">{{ t('clear') }}</m3e-button></div></m3e-card>
    <div v-if="feedback" class="inline-feedback">{{ feedback }}</div>
  </section>
</template>
