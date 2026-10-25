<!--
  会话高级设置：自动批准、模型能力、按用途指定模型、自动批准上限和自动压缩。
  只接收当前 session，所有写操作仍交给 commands/session；不再和 SessionView 的页面装配混在一起。
  调用示例：<SessionMorePanel :session="session" />
-->
<script setup>
import { computed } from 'vue'
import { KimaChip, KimaSelect } from '@kernel4632/kima'
import { AppIcon, Field } from '../ui/index.js'
import { AUTO_APPROVE_KINDS, Session, USE_LABELS } from '../commands/session.js'
import { store } from '../store.js'

defineProps({
  session: { type: Object, required: true },
})

const allModels = () => Object.entries(store.config.providers || {})
  .flatMap(([provider, entry]) => (entry.models || []).map(model => ({ provider, model })))  // 把所有供应商的模型摊平成一份列表

const useModelOptions = computed(() => [
  { value: '', label: '和主模型共用' },                                                    // 空值表示不改，继续用主模型
  ...allModels().map(item => ({ value: `${item.provider}/${item.model}`, label: `${item.provider} / ${item.model}` })),
])

const useKey = (session, use) => {
  const target = session.settings.uses?.[use]
  return target ? `${target.provider}/${target.model}` : ''                                 // 已指定的用途显示 provider/model
}

const targetFrom = (session, value) => {
  if (!value) return null                                                                   // 选“共用”时清掉这条用途
  const [provider, ...rest] = value.split('/')                                              // 模型名里可能还有斜杠，只切第一段
  return { provider, model: rest.join('/') }
}
</script>

<template>
  <div class="chat-more">
    <section class="chat-more__group" aria-label="自动批准">
      <h2>自动批准</h2>
      <p>按类别跳过审批；.agentignore 仍然生效。</p>
      <div class="chat-more__chips">
        <KimaChip v-for="item in AUTO_APPROVE_KINDS" :key="item.kind" selectable :label="item.label" :model-value="!!session.settings.autoApprove?.[item.kind]" :title="`自动批准「${item.label}」：${item.hint}`" @change="Session.toggleAutoApprove(session.id, item.kind)">
          <AppIcon :name="item.icon" :size="16" />{{ item.label }}
        </KimaChip>
      </div>
    </section>

    <section class="chat-more__group" aria-label="模型能力">
      <h2>模型能力</h2>
      <p>按模型支持情况开关。</p>
      <div class="chat-more__chips">
        <KimaChip selectable label="图像" :model-value="session.settings.capabilities.image" title="允许把图片发给模型" @change="Session.toggleCapability(session.id, 'image')"><AppIcon name="globe" :size="16" />图像</KimaChip>
        <KimaChip selectable label="缓存" :model-value="session.settings.capabilities.cache" title="提示词缓存，命中就是省时间和省钱" @change="Session.toggleCapability(session.id, 'cache')"><AppIcon name="copy" :size="16" />缓存</KimaChip>
        <KimaChip selectable label="流式" :model-value="session.settings.capabilities.stream" title="流式输出：回复边生成边显示" @change="Session.toggleCapability(session.id, 'stream')"><AppIcon name="spark" :size="16" />流式</KimaChip>
        <KimaChip selectable label="自动标题" :model-value="session.settings.autoTitle" title="第一次聊完让模型起个标题" @change="Session.toggleAutoTitle(session.id)"><AppIcon name="edit" :size="16" />自动标题</KimaChip>
      </div>
    </section>

    <section class="chat-more__group" aria-label="按用途指定模型">
      <h2>哪件事用哪个模型</h2>
      <p>不选就和主模型（{{ session.model }}）共用</p>
      <div v-for="(label, use) in USE_LABELS" :key="use" class="chat-more__row">
        <span>{{ label }}</span>
        <KimaSelect
          class="chat-more__select"
          :label="label"
          :model-value="useKey(session, use)"
          :items="useModelOptions"
          @update:model-value="Session.setUse(session.id, use, targetFrom(session, $event))"
        />
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
/* KIMA 没有 small 尺寸；这里只压低控件高度和字号，和同一行里的 Field 对齐。 */
.chat-more__select { --kima-field-height: 48px; --kima-field-padding: 16px; }
.chat-more__select :deep(.kima-select__trigger) { font-size: var(--kima-font-size-body-small, 14px); }
/* KimaSelect 的弹层是控件内绝对定位，不走 portal；面板最底部一行的弹层可能被滚动容器裁掉，等 KIMA 修复。 */
@media (max-width: 767px) {
  .chat-more { grid-template-columns: minmax(0, 1fr); gap: 20px; padding: 16px; max-height: 60vh; }
  .chat-more__row .chat-more__field, .chat-more__row .chat-more__select { width: 150px; max-width: 150px; }
}
</style>
