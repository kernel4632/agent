<!--
主题提供层：统一管理 M3E 的主题属性、强调色和 token 导出，App 只传 appearance。
换主题库时替换本文件和 m3e.js，业务页面不用改。
调用示例：<ThemeProvider :appearance="appearance"><div class="preview-page">...</div></ThemeProvider>
-->
<script setup>
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue'
import { applyPalette } from '@kernel4632/kima/theme'
import { syncM3ETokens } from './m3e.js'

const props = defineProps({
  appearance: { type: Object, required: true },          // 规范化后的外观设置（主题、颜色、动效等）
})

const theme = ref(null)                                  // 当前 m3e-theme 元素
const system = window.matchMedia('(prefers-color-scheme: dark)')
const systemDark = ref(system.matches)                   // 系统当前是不是深色
const scheme = computed(() => props.appearance.theme === 'system'
  ? systemDark.value ? 'dark' : 'light'
  : props.appearance.theme)                              // 最终生效的深浅色
const updateSystem = event => { systemDark.value = event.matches }
let observer = null                                      // 监听 M3E 属性变化，变化后重新导出 token

// 把 appearance 写到 m3e-theme 上；post 保证元素先挂载再写属性。
watchEffect(() => {
  const element = theme.value
  if (!element) return
  const appearance = props.appearance
  element.setAttribute('scheme', scheme.value)
  for (const key of ['color', 'variant', 'contrast', 'density', 'motion']) element.setAttribute(key, String(appearance[key]))
  element.toggleAttribute('strong-focus', appearance.strongFocus)
  element.toggleAttribute('reduced-motion', appearance.reduceMotion)
  // KIMA 与 M3E 共用同一套深浅色和强调色，避免组件库自成一套主题。
  document.documentElement.setAttribute('data-kima-theme', scheme.value)
  applyPalette(appearance.color, { isDark: scheme.value === 'dark', variant: appearance.variant })
}, { flush: 'post' })

// 挂载：跟随系统主题，并在 M3E 首次渲染后导出 token。
onMounted(() => {
  system.addEventListener('change', updateSystem)
  // 两帧后 M3E 的 shadow DOM 已完成首次计算，此时读取的 token 才有效。
  requestAnimationFrame(() => requestAnimationFrame(() => {
    syncM3ETokens(theme.value)
    if (!theme.value) return
    // scheme/color/variant/contrast 变化会影响色板，重新导出到 :root。
    observer = new MutationObserver(() => syncM3ETokens(theme.value))
    observer.observe(theme.value, {
      attributes: true,
      attributeFilter: ['scheme', 'color', 'variant', 'contrast'],
    })
  }))
})

// 卸载：移除系统监听和属性观察器，避免组件离开后继续写 :root。
onUnmounted(() => {
  system.removeEventListener('change', updateSystem)
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <m3e-theme ref="theme"><slot /></m3e-theme>
</template>
