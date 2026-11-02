<!-- 任务进度：浏览器原生 progress。示例：<Progress :value="2" :max="5" label="进度" /> -->
<script setup>defineProps({ value: Number, max: { type: Number, default: 100 }, label: String })</script>
<template><progress class="ui-progress" :value="value" :max="max" :aria-label="label"></progress></template>
<style scoped lang="scss" src="../styles/ui/Progress.scss"></style>
