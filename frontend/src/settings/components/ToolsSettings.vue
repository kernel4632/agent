<!--
工具管理：默认是工具列表，点一行进入该工具的权限页。
列表只负责选择；权限页用 KIMA RadioGroup 选自动执行 / 每次询问 / 禁止调用。
核心数据：tools（每项含 name、title、kind、permission）；开关不再另存一份 enabled。
调用示例：<ToolsSettings v-model:tools="draft.tools" :detail="detail" @open-detail="..." @close-detail="..." />
-->
<script setup>
import { computed } from 'vue'
import { KimaRadioGroup } from '@kernel4632/kima'
import { AppIcon, Button, ChoiceContent } from '../../ui/index.js'

const props = defineProps({
  tools: { type: Array, required: true },
  detail: { type: Object, default: null },
})
const emit = defineEmits(['update:tools', 'open-detail', 'close-detail', 'update-detail-title'])

const KIND_LABELS = { read: '读取', write: '写入', command: '执行命令', mcp: 'MCP', subtask: '子任务', other: '自定义' }
const kindLabel = tool => KIND_LABELS[tool.kind] || '工具'

const PERMISSION_OPTIONS = [
  { value: 'allow', label: '自动执行', description: '不弹审批，直接执行', icon: 'check' },
  { value: 'ask', label: '每次询问', description: '执行前先问你一句', icon: 'info' },
  { value: 'deny', label: '禁止调用', description: '请求会被拒绝，模型仍能看到这个工具', icon: 'close' },
]
const permissionLabel = permission => PERMISSION_OPTIONS.find(item => item.value === permission)?.label || '每次询问'

const selected = computed(() => props.detail
  ? props.tools.find(tool => tool.name === props.detail.id) ?? null
  : null)

function updatePermission(name, permission) {
  const updated = props.tools.map(tool => tool.name === name ? { ...tool, permission } : tool)
  emit('update:tools', updated)
  if (props.detail?.id === name) emit('update-detail-title', props.tools.find(tool => tool.name === name)?.title || name)
}
</script>

<template>
  <section v-if="!detail" class="tools-settings" aria-label="工具管理">
    <header class="tools-head">
      <p>控制每个工具是否可用，以及调用前是否需要先问你。</p>
    </header>

    <div v-if="tools.length" class="settings-list">
      <Button
        v-for="tool in tools"
        :key="tool.name"
        variant="plain"
        class="tool-row"
        @click="emit('open-detail', { id: tool.name, title: tool.title || tool.name })"
      >
        <span class="tool-row__icon" aria-hidden="true"><AppIcon :name="tool.ui?.icon || 'code'" :size="20" /></span>
        <span class="tool-row__copy">
          <strong>{{ tool.title || tool.name }}</strong>
          <small>{{ kindLabel(tool) }} · {{ tool.name }}</small>
        </span>
        <span class="tool-row__state" :class="{ 'is-deny': tool.permission === 'deny' }">{{ permissionLabel(tool.permission) }}</span>
        <AppIcon name="arrow" :size="16" class="tool-row__arrow" aria-hidden="true" />
      </Button>
    </div>
    <p v-else class="tools-settings__empty">暂无可配置的工具</p>
  </section>

  <section v-else-if="selected" class="tool-detail" aria-label="工具权限">
    <header class="tool-detail__head">
      <span class="tool-detail__icon" aria-hidden="true"><AppIcon :name="selected.ui?.icon || 'code'" :size="22" /></span>
      <div>
        <h3>{{ selected.title || selected.name }}</h3>
        <p>{{ kindLabel(selected) }} · {{ selected.name }}</p>
      </div>
    </header>

    <KimaRadioGroup
      label="权限"
      :model-value="selected.permission"
      :options="PERMISSION_OPTIONS"
      @update:model-value="updatePermission(selected.name, $event)"
    >
      <template #option="{ item, selected: on }">
        <ChoiceContent
          :selected="on"
          :show-mark="false"
          :icon="item.icon"
          :title="item.label"
          :hint="item.description"
        />
      </template>
    </KimaRadioGroup>
  </section>

  <div v-else class="tool-missing">
    <p>这个工具已经不存在了。</p>
    <Button @click="emit('close-detail')">返回工具列表</Button>
  </div>
</template>

<style scoped lang="scss">
.tools-settings { display: flex; min-height: 0; flex-direction: column; gap: 20px; }
.tools-head p { margin: 0; color: var(--la-muted); font-size: 14px; font-weight: 400; line-height: 22px; }
.settings-list {
  overflow: hidden;
  border-radius: 24px;
  background: var(--la-layer-01);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .08);
}
.tool-row {
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
.tool-row + .tool-row { border-top: .5px solid var(--la-line); }
.tool-row:hover { background: var(--la-hover); }
.tool-row:focus-visible { position: relative; z-index: 1; outline-offset: -2px; }
.tool-row__icon {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  place-items: center;
  border-radius: 14px;
  background: var(--la-layer-02);
  color: var(--la-secondary);
}
.tool-row__copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.tool-row__copy strong { overflow: hidden; color: var(--la-text); font-size: 16px; font-weight: 600; line-height: 24px; text-overflow: ellipsis; white-space: nowrap; }
.tool-row__copy small { overflow: hidden; color: var(--la-muted); font-size: 13px; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
.tool-row__state { flex: none; color: var(--la-muted); font-size: 13px; line-height: 20px; }
.tool-row__state.is-deny { color: var(--la-danger); }
.tool-row__arrow { flex: none; color: var(--la-muted); }
.tools-settings__empty { margin: 0; padding: 40px 20px; border-radius: 24px; background: var(--la-layer-01); color: var(--la-muted); text-align: center; font-size: 14px; }

.tool-detail { display: grid; gap: 24px; }
.tool-detail__head { display: flex; align-items: center; gap: 16px; padding: 20px; border-radius: 20px; background: var(--la-layer-01); }
.tool-detail__icon { display: grid; width: 48px; height: 48px; flex: none; place-items: center; border-radius: 15px; background: color-mix(in srgb, var(--la-accent) 16%, transparent); color: var(--la-accent); }
.tool-detail__head h3 { margin: 0; color: var(--la-text); font-size: 18px; font-weight: 600; line-height: 26px; }
.tool-detail__head p { margin: 2px 0 0; color: var(--la-muted); font-size: 13px; line-height: 20px; }
.tool-detail :deep(.kima-radio-group) { gap: 8px; }
.tool-detail :deep(.kima-radio-group__item) {
  min-height: 68px;
  padding: 12px 16px;
  gap: 14px;
  border: 1px solid transparent;
  border-radius: 16px;
  background: var(--la-layer-01);
  color: var(--la-text);
}
.tool-detail :deep(.kima-radio-group__item:hover) { border-color: var(--la-line); background: var(--la-layer-02); }
.tool-detail :deep(.kima-radio-group__item:has(input:checked)) {
  border-color: var(--la-accent-border);
  background: color-mix(in srgb, var(--la-accent) 9%, var(--la-layer-01));
  color: var(--la-text);
}
.tool-detail :deep(.kima-radio-group__item > input) { order: 3; margin-inline-start: auto; }
.tool-missing { display: grid; justify-items: start; gap: 16px; padding: 24px; border-radius: 20px; background: var(--la-layer-01); }
.tool-missing p { margin: 0; color: var(--la-muted); font-size: 14px; }

@media (max-width: 767px) {
  .tool-row { min-height: 80px; padding: 12px 16px; }
  .tool-row__state { display: none; }
  .tool-detail__head { padding: 16px; }
}
</style>
