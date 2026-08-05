<!-- 尚未实现的设置分类：保持页面层级稳定，后续可直接替换正文。 -->
<script setup>
const props = defineProps({
  title: { type: String, required: true },
  description: { type: String, required: true },
  icon: { type: String, required: true },
})
</script>

<template>
  <section class="settings-placeholder">
    <m3e-icon :name="props.icon" filled="1"></m3e-icon>
    <m3e-heading variant="headline" size="small" level="2">{{ props.title }}</m3e-heading>
    <p>{{ props.description }}</p>
  </section>
</template>

<style scoped lang="scss">
.settings-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 420px;
  gap: 14px;
  padding: 32px;
  color: #8f8f8f;
  text-align: center;

  > m3e-icon {
    color: #b8b8b8;
    font-size: 40px;
  }

  p {
    max-width: 460px;
    margin: 0;
    line-height: 1.7;
  }
}
</style>
