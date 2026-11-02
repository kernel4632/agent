<!-- 简单排布：gap 按 4px 计。示例：<Flex direction="column" :gap="4">内容</Flex> -->
<script setup>defineProps({ direction: { type: String, default: 'row' }, gap: { type: Number, default: 2 }, justify: String, align: String })</script>
<template><div class="ui-flex" :style="{ '--flex-direction': direction, '--flex-gap': `${gap * 4}px`, '--flex-justify': justify, '--flex-align': align }"><slot /></div></template>
<style scoped lang="scss" src="../styles/ui/Flex.scss"></style>
