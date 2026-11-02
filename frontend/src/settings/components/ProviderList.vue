<!--
模型供应商列表：一层页面只负责选择供应商，点一行进入供应商编辑页。
“添加供应商”也在这一层完成；新增后直接打开它的编辑页，减少一次点击。
调用示例：<ProviderList :providers="providers" @select="openProvider" @add="addProvider" />
-->
<script setup>
import { AppIcon, Button } from '../../ui/index.js'

defineProps({ providers: { type: Array, required: true } })
defineEmits(['select', 'add'])
</script>

<template>
  <section class="provider-list" aria-label="模型供应商">
    <header class="provider-list__head">
      <p>连接模型服务，管理每个供应商下的可用模型。</p>
      <Button @click="$emit('add')"><AppIcon name="plus" :size="18" />添加供应商</Button>
    </header>

    <div v-if="providers.length" class="provider-list__card">
      <Button
        v-for="provider in providers"
        :key="provider.id"
        variant="plain"
        class="provider-row"
        @click="$emit('select', provider)"
      >
        <span class="provider-row__icon" aria-hidden="true"><AppIcon name="globe" :size="20" /></span>
        <span class="provider-row__copy">
          <strong>{{ provider.name }}</strong>
          <small>{{ provider.apiUrl || '未填写请求地址' }} · {{ provider.models.length }} 个模型</small>
        </span>
        <span class="provider-row__state" :class="{ 'is-on': provider.enabled }">{{ provider.enabled ? '已启用' : '已停用' }}</span>
        <AppIcon name="arrow" :size="16" class="provider-row__arrow" aria-hidden="true" />
      </Button>
    </div>

    <p v-else class="provider-list__empty">还没有供应商。先添加一个模型服务。</p>
  </section>
</template>

<style scoped lang="scss" src="../../styles/settings/components/ProviderList.scss"></style>
