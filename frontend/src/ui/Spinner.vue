<!-- 等待图标：可装饰使用，也可作为状态。示例：<Spinner label="正在连接" /> -->
<script setup>defineProps({ size: String, label: String, decorative: Boolean })</script>
<template><span class="ui-spinner" :class="`ui-spinner--${size}`" :role="decorative ? undefined : 'status'" :aria-label="label" :aria-hidden="decorative || undefined"><span class="ui-spinner__ring"></span></span></template>
<style scoped lang="scss" src="../styles/ui/Spinner.scss"></style>
