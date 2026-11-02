<!-- 主题：把当前偏好写到根节点，弹层与正文共享同一套颜色。示例：<ThemeProvider :appearance="appearance"><App /></ThemeProvider> -->
<script setup>
import { computed, onBeforeUnmount, ref, watchEffect } from 'vue'
import { applyTheme } from './palette.js'
const props = defineProps({ appearance: { type: Object, required: true } })
const system = window.matchMedia('(prefers-color-scheme: dark)')
const systemDark = ref(system.matches)
const scheme = computed(() => props.appearance.theme === 'system' ? (systemDark.value ? 'dark' : 'light') : props.appearance.theme)
const updateSystem = event => { systemDark.value = event.matches }
system.addEventListener('change', updateSystem)
watchEffect(() => applyTheme(props.appearance, scheme.value))
onBeforeUnmount(() => system.removeEventListener('change', updateSystem))
</script>
<template><div class="app-theme" :data-theme="scheme"><slot /></div></template>
<style scoped lang="scss" src="../styles/theme/ThemeProvider.scss"></style>
