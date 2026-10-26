<!--
对话设置抽屉：模式、自动批准、模型能力、模型分工和上下文限制。
内容放在右侧抽屉里，和任务清单同一套位置，不再挤在输入框上方；所有控件走 KIMA。
新对话页还没有会话，只显示模式和新会话默认自动批准，发送时再写进会话。
调用示例：<ConversationSettingsDrawer :open="open" :session="session" @update:open="open = $event" />
-->
<script setup>
import { computed } from 'vue'
import { KimaDrawer, KimaSelect } from '@kernel4632/kima'
import { Field, Switch } from '../ui/index.js'
import { AUTO_APPROVE_KINDS, Session, USE_LABELS } from '../commands/session.js'
import { store } from '../store.js'

const props = defineProps({
  open: Boolean,
  session: { type: Object, default: null },
  draftMode: { type: String, default: 'build' },
  draftAutoApprove: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:open', 'update:draft-mode', 'update:draft-auto-approve'])

const modeItems = computed(() => (store.config.modes?.length ? store.config.modes : [
  { name: 'build', label: '执行模式', readOnly: false },
  { name: 'plan', label: '计划模式', readOnly: true },
]).map(item => ({ value: item.name, label: item.label })))

const title = computed(() => props.session ? '对话设置' : '新对话设置')
const mode = computed(() => props.session?.settings.mode || props.draftMode)
const autoApprove = computed(() => props.session?.settings.autoApprove || props.draftAutoApprove || {})

const allModels = () => Object.entries(store.config.providers || {})
  .flatMap(([provider, entry]) => (entry.models || []).map(model => ({ provider, model })))
const useModelOptions = computed(() => [
  { value: '', label: '和主模型共用' },
  ...allModels().map(item => ({ value: `${item.provider}/${item.model}`, label: `${item.provider} / ${item.model}` })),
])
const useKey = use => {
  const target = props.session?.settings.uses?.[use]
  return target ? `${target.provider}/${target.model}` : ''
}
const targetFrom = value => {
  if (!value) return null
  const [provider, ...rest] = value.split('/')
  return { provider, model: rest.join('/') }
}

const capabilityRows = [
  { key: 'image', label: '图像', hint: '允许把图片发给模型' },
  { key: 'cache', label: '缓存', hint: '命中提示词缓存时省时间和费用' },
  { key: 'stream', label: '流式', hint: '回复边生成边显示' },
]

function setMode(value) {
  if (props.session) void Session.setMode(props.session.id, value)
  else emit('update:draft-mode', value)
}

function toggleAutoApprove(kind) {
  if (props.session) {
    void Session.toggleAutoApprove(props.session.id, kind)
    return
  }
  emit('update:draft-auto-approve', { ...props.draftAutoApprove, [kind]: !props.draftAutoApprove?.[kind] })
}

function toggleCapability(key) {
  if (props.session) void Session.toggleCapability(props.session.id, key)
}
</script>

<template>
  <KimaDrawer
    class="conversation-settings"
    :open="open"
    :title="title"
    placement="right"
    @update:open="emit('update:open', $event)"
  >
    <div class="conversation-settings__body">
      <p class="conversation-settings__lead">
        {{ session ? '这段对话的工具权限、模型能力和上下文限制。' : '发送第一条消息时，这些设置会写进新对话。' }}
      </p>

      <section class="conversation-settings__section">
        <h3>模式</h3>
        <p>计划模式只保留只读工具，避免在思考阶段改文件。</p>
        <KimaSelect label="模式" :model-value="mode" :items="modeItems" @update:model-value="setMode" />
      </section>

      <section class="conversation-settings__section">
        <h3>自动批准</h3>
        <p>按类别跳过审批；<code>.agentignore</code> 仍然生效，危险操作仍会先问你。</p>
        <div class="conversation-settings__rows">
          <div v-for="item in AUTO_APPROVE_KINDS" :key="item.kind" class="conversation-settings__row">
            <div class="conversation-settings__copy">
              <strong>{{ item.label }}</strong>
              <small>{{ item.hint }}</small>
            </div>
            <Switch hide-label :model-value="!!autoApprove?.[item.kind]" :label="item.label" @update:model-value="toggleAutoApprove(item.kind)" />
          </div>
        </div>
      </section>

      <template v-if="session">
        <section class="conversation-settings__section">
          <h3>模型能力</h3>
          <p>按模型提供的实际能力开关。</p>
          <div class="conversation-settings__rows">
            <div v-for="item in capabilityRows" :key="item.key" class="conversation-settings__row">
              <div class="conversation-settings__copy">
                <strong>{{ item.label }}</strong>
                <small>{{ item.hint }}</small>
              </div>
              <Switch hide-label :model-value="session.settings.capabilities[item.key]" :label="item.label" @update:model-value="toggleCapability(item.key)" />
            </div>
            <div class="conversation-settings__row">
              <div class="conversation-settings__copy">
                <strong>自动标题</strong>
                <small>第一次聊完让模型给会话起标题</small>
              </div>
              <Switch hide-label :model-value="session.settings.autoTitle" label="自动标题" @update:model-value="Session.toggleAutoTitle(session.id)" />
            </div>
          </div>
        </section>

        <section class="conversation-settings__section">
          <h3>哪件事用哪个模型</h3>
          <p>不选就和主模型（{{ session.model }}）共用。</p>
          <div class="conversation-settings__fields">
            <label v-for="(label, use) in USE_LABELS" :key="use" class="conversation-settings__field">
              <span>{{ label }}</span>
              <KimaSelect :label="label" :model-value="useKey(use)" :items="useModelOptions" @update:model-value="Session.setUse(session.id, use, targetFrom($event))" />
            </label>
          </div>
        </section>

        <section class="conversation-settings__section">
          <h3>上限与压缩</h3>
          <p>连着自动批准太多次就停下来问一句；上下文用到阈值时自动总结。</p>
          <div class="conversation-settings__fields">
            <Field size="small" caption="自动批准连续次数（0 表示不设上限）" type="number" label="连续次数" min="0" :model-value="session.settings.autoApproveLimit" @change="Session.setLimit(session.id, Number($event))" />
            <Field size="small" caption="自动压缩阈值（0.1 到 0.99）" type="number" label="阈值" min="0.1" max="0.99" step="0.05" :model-value="session.settings.compactThreshold ?? 0.8" @change="Session.setCompactThreshold(session.id, Number($event))" />
          </div>
        </section>
      </template>

      <p v-else class="conversation-settings__note">新对话还没有历史记录，模型能力和模型分工会在会话创建后出现。</p>
    </div>
  </KimaDrawer>
</template>

<style scoped lang="scss">
.conversation-settings { --kima-drawer-max-width: 380px; }
.conversation-settings__body { display: flex; min-width: 0; flex-direction: column; gap: 26px; padding-bottom: 12px; }
.conversation-settings__lead { margin: 0; color: var(--la-secondary); font-size: 14px; line-height: 22px; }
.conversation-settings__section { display: flex; min-width: 0; flex-direction: column; gap: 12px; }
.conversation-settings__section h3 { margin: 0; color: var(--la-text); font-size: 16px; font-weight: 600; line-height: 24px; }
.conversation-settings__section > p { margin: 0; color: var(--la-muted); font-size: 13px; line-height: 20px; }
.conversation-settings__section > p code { font-family: var(--la-font-mono); }
.conversation-settings__rows { padding: 2px 16px; border-radius: 18px; background: var(--la-layer-01); }
.conversation-settings__row { display: flex; min-width: 0; align-items: center; gap: 16px; padding: 13px 0; border-bottom: .5px solid var(--la-line); }
.conversation-settings__row:last-child { border-bottom: 0; }
.conversation-settings__copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.conversation-settings__copy strong { color: var(--la-text); font-size: 14px; font-weight: 500; line-height: 22px; }
.conversation-settings__copy small { color: var(--la-muted); font-size: 12px; line-height: 18px; }
.conversation-settings__fields { display: flex; flex-direction: column; gap: 14px; }
.conversation-settings__field { display: flex; flex-direction: column; gap: 6px; color: var(--la-secondary); font-size: 13px; line-height: 18px; }
.conversation-settings__note { margin: 0; padding: 14px 16px; border-radius: 16px; background: var(--la-layer-01); color: var(--la-muted); font-size: 13px; line-height: 20px; }
</style>
