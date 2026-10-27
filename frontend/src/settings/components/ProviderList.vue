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

<style scoped lang="scss">
.provider-list { display: flex; flex-direction: column; gap: 16px; }
.provider-list__head { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.provider-list__head p { margin: 0; color: var(--la-muted); font-size: 14px; line-height: 22px; }
.provider-list__card {
  overflow: hidden;
  border-radius: 24px;
  background: var(--la-layer-01);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .08);
}
.provider-row {
  display: flex;
  width: 100%;
  min-height: 84px;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--la-text);
  text-align: left;
  cursor: pointer;
}
.provider-row + .provider-row { border-top: .5px solid var(--la-line); }
.provider-row:hover { background: var(--la-hover); }
.provider-row:focus-visible { position: relative; z-index: 1; outline-offset: -2px; }
.provider-row__icon {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  place-items: center;
  border-radius: 14px;
  background: color-mix(in srgb, var(--la-accent) 16%, transparent);
  color: var(--la-accent);
}
.provider-row__copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.provider-row__copy strong { overflow: hidden; color: var(--la-text); font-size: 16px; font-weight: 600; line-height: 24px; text-overflow: ellipsis; white-space: nowrap; }
.provider-row__copy small { overflow: hidden; color: var(--la-muted); font-size: 13px; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
.provider-row__state { flex: none; color: var(--la-muted); font-size: 13px; line-height: 20px; }
.provider-row__state.is-on { color: var(--la-success); }
.provider-row__arrow { flex: none; color: var(--la-muted); }
.provider-list__empty { margin: 0; padding: 40px 20px; border-radius: 24px; background: var(--la-layer-01); color: var(--la-muted); text-align: center; font-size: 14px; }
@media (max-width: 767px) {
  .provider-list__head { align-items: flex-start; flex-direction: column; gap: 12px; }
  .provider-row { min-height: 80px; padding: 12px 16px; }
  .provider-row__state { display: none; }
}
</style>
