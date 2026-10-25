<!--
  会话高级设置：自动批准、模型能力、按用途指定模型、自动批准上限和自动压缩。
  只接收当前 session，所有写操作仍交给 commands/session；不再和 SessionView 的页面装配混在一起。
-->
<script setup>
import { computed } from 'vue'
import { AppIcon, Button, Field, Select } from '../ui/index.js'
import { AUTO_APPROVE_KINDS, Session, USE_LABELS } from '../commands/session.js'
import { store } from '../store.js'

defineProps({
  session: { type: Object, required: true },
})

const allModels = () => Object.entries(store.config.providers || {})
  .flatMap(([provider, entry]) => (entry.models || []).map(model => ({ provider, model })))

const useModelOptions = computed(() => [
  { value: '', label: '和主模型共用' },
  ...allModels().map(item => ({ value: `${item.provider}/${item.model}`, label: `${item.provider} / ${item.model}` })),
])

const useKey = (session, use) => {
  const target = session.settings.uses?.[use]
  return target ? `${target.provider}/${target.model}` : ''
}

const targetFrom = (session, value) => {
  if (!value) return null
  const [provider, ...rest] = value.split('/')
  return { provider, model: rest.join('/') }
}
</script>

<template>
  <div class="chat-more">
    <section class="chat-more__group" aria-label="自动批准">
      <h2>自动批准</h2>
      <p>按类别跳过审批；.agentignore 仍然生效。</p>
      <div class="chat-more__chips">
        <Button v-for="item in AUTO_APPROVE_KINDS" :key="item.kind" variant="plain" class="chip chip--compact" :class="{ 'chip--active': session.settings.autoApprove?.[item.kind] }" :title="`自动批准「${item.label}」：${item.hint}`" @click="Session.toggleAutoApprove(session.id, item.kind)"><AppIcon :name="item.icon" :size="12" />{{ item.label }}</Button>
      </div>
    </section>

    <section class="chat-more__group" aria-label="模型能力">
      <h2>模型能力</h2>
      <p>按模型支持情况开关。</p>
      <div class="chat-more__chips">
        <Button variant="plain" class="chip chip--compact" :class="{ 'chip--active': session.settings.capabilities.image }" title="允许把图片发给模型" @click="Session.toggleCapability(session.id, 'image')"><AppIcon name="globe" :size="12" />图像</Button>
        <Button variant="plain" class="chip chip--compact" :class="{ 'chip--active': session.settings.capabilities.cache }" title="提示词缓存，命中就是省时间和省钱" @click="Session.toggleCapability(session.id, 'cache')"><AppIcon name="copy" :size="12" />缓存</Button>
        <Button variant="plain" class="chip chip--compact" :class="{ 'chip--active': session.settings.capabilities.stream }" title="流式输出：回复边生成边显示" @click="Session.toggleCapability(session.id, 'stream')"><AppIcon name="spark" :size="12" />流式</Button>
        <Button variant="plain" class="chip chip--compact" :class="{ 'chip--active': session.settings.autoTitle }" title="第一次聊完让模型起个标题" @click="Session.toggleAutoTitle(session.id)"><AppIcon name="edit" :size="12" />自动标题</Button>
      </div>
    </section>

    <section class="chat-more__group" aria-label="按用途指定模型">
      <h2>哪件事用哪个模型</h2>
      <p>不选就和主模型（{{ session.model }}）共用</p>
      <div v-for="(label, use) in USE_LABELS" :key="use" class="chat-more__row">
        <span>{{ label }}</span>
        <Select size="small" class="chat-more__select" :label="label" :model-value="useKey(session, use)" :options="useModelOptions" @update:model-value="Session.setUse(session.id, use, targetFrom(session, $event))" />
      </div>
    </section>

    <section class="chat-more__group" aria-label="自动批准的刹车">
      <h2>自动批准的上限</h2>
      <p>连着自动批准这么多次就停下来问一句；填 0 表示不设上限</p>
      <div class="chat-more__row"><span>连续次数</span>
        <Field size="small" class="chat-more__field" type="number" label="连续次数" min="0" :model-value="session.settings.autoApproveLimit" @change="Session.setLimit(session.id, Number($event))" />
      </div>
    </section>

    <section class="chat-more__group" aria-label="上下文压缩">
      <h2>自动压缩</h2>
      <p>上下文用到这个比例时自动总结；范围 0.1 到 0.99</p>
      <div class="chat-more__row"><span>阈值</span>
        <Field size="small" class="chat-more__field" type="number" label="阈值" min="0.1" max="0.99" step="0.05" :model-value="session.settings.compactThreshold ?? 0.8" @change="Session.setCompactThreshold(session.id, Number($event))" />
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.chat-more {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
  max-height: min(56vh, 520px);
  margin-bottom: 12px;
  padding: 20px;
  overflow-y: auto;
  border-radius: 20px;
  background: var(--la-layer-01);
  box-shadow: inset 0 0 0 .5px var(--la-line);
}
.chat-more__group { min-width: 0; }
.chat-more__group h2 { margin: 0; color: var(--la-text); font-size: 15px; font-weight: 600; line-height: 22px; }
.chat-more__group p { margin: 6px 0 12px; color: var(--la-muted); font-size: 13px; font-weight: 400; line-height: 20px; }
.chat-more__chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chat-more__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; color: var(--la-secondary); font-size: 14px; }
.chat-more__row .chat-more__field, .chat-more__row .chat-more__select { width: 180px; max-width: 180px; min-width: 0; flex: none; }
.chip { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border: 0; border-radius: 999px; background: var(--la-layer-02); color: var(--la-muted); font-size: 13px; cursor: pointer; }
.chip:hover:not(:disabled) { color: var(--la-text); background: var(--la-layer-03); }
.chip--active { background: var(--la-accent-soft); color: var(--la-accent); }
.chip:disabled { opacity: .5; }
.chip--compact { min-height: 36px; padding: 0 12px; }
@media (max-width: 767px) {
  .chat-more { grid-template-columns: minmax(0, 1fr); gap: 20px; padding: 16px; max-height: 60vh; }
  .chat-more__row .chat-more__field, .chat-more__row .chat-more__select { width: 150px; max-width: 150px; }
}
</style>
