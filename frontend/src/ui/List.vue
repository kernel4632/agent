<!-- 可自定义行内容的列表。示例：<List :items="sessions"><template #item="{item}">{{item.title}}</template></List> -->
<script setup>defineProps({ items: { type: Array, default: () => [] }, label: String, gap: { type: Number, default: 2 } })</script>
<template><ul class="ui-list" :aria-label="label" :style="{ '--list-gap': `${gap * 4}px` }"><li v-for="(item, index) in items" :key="item.id ?? index"><slot name="item" :item="item" /></li></ul></template>
<style scoped lang="scss" src="../styles/ui/List.scss"></style>
