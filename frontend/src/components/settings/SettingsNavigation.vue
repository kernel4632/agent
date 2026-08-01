<!-- 设置分类导航：只展示分类和保存状态，并发出分类选择意图。 -->
<script setup>
import { t } from '../../i18n.js'                                      // 提供分类和保存反馈文案
defineProps({ sections: { type: Array, default: () => [] }, active: { type: String, default: '' }, saved: { type: Boolean, default: false } })
defineEmits(['select'])                                                // 导航动作交回设置页
</script>

<template>
  <aside class="settings-nav">
    <header><h1>{{ t('settings') }}</h1><small v-if="saved">{{ t('autoSaved') }}</small></header>
    <m3e-button v-for="section in sections" :key="section.id" :variant="active === section.id ? 'tonal' : 'text'" :class="{ 'is-active': active === section.id }" @click="$emit('select', section.id)">
      <m3e-icon slot="icon" :name="section.icon"></m3e-icon><span>{{ t(section.label) }}</span>
    </m3e-button>
    <footer>{{ t('autoSaveOnLeave') }}</footer>
  </aside>
</template>
