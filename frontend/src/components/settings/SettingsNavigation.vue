<!--
设置分类导航：只展示架构设计规定的六个设置入口。
用户点击分类后，组件只把分类 ID 交给设置页，不在这里修改页面状态。
调用示例：<SettingsNavigation :sections="sections" :active="activeSection" @select="openSection" />
-->
<script setup>
import { t } from '../../i18n.js'                                      // 将分类名称转换为当前语言

defineProps({                                                          // 接收设置页提供的导航数据
  sections: { type: Array, default: () => [] },                        // 六个可进入的设置分类
  active: { type: String, default: '' },                               // 当前正在显示的分类 ID
})
defineEmits(['select'])                                                // 将用户选择交回设置页执行
</script>

<template>
  <!-- 设置页只需要一层分类侧栏，避免重复图标导航增加理解成本。 -->
  <aside class="settings-nav" :aria-label="t('settings')">
    <m3e-button v-for="section in sections" :key="section.id" :variant="active === section.id ? 'tonal' : 'text'" :class="{ 'is-active': active === section.id }" @click="$emit('select', section.id)">
      <m3e-icon slot="icon" :name="section.icon"></m3e-icon><span>{{ t(section.label) }}</span>
    </m3e-button>
  </aside>
</template>
