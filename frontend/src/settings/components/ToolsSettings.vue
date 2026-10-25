<!--
工具权限管理：展示 Agent 可调用的所有工具，支持启用/禁用和权限级别设置。
设计思想：工具列表由 Server 配置加载，每次修改立即写入草稿；保存由设置页统一触发。
核心数据：tools（工具配置数组，每项含 name、enabled、permission）。
权限下拉直接用 KimaSelect，开关仍走 ui/Switch；权限和启用的联动仍在本组件完成。
调用示例：<ToolsSettings v-model:tools="settingsDraft.tools" />。
-->
<script setup>
import { KimaSelect } from '@kernel4632/kima'
import { Switch } from '../../ui/index.js'

const props = defineProps({
  tools: { type: Array, required: true },
})
const emit = defineEmits(['update:tools'])

const KIND_LABELS = { read: '读取', write: '写入', command: '执行命令', mcp: 'MCP', subtask: '子任务', other: '自定义' }
const kindLabel = tool => KIND_LABELS[tool.kind] || '工具'

// 权限下拉的选项固定为三档，文案和保存到配置里的值一一对应。
const PERMISSION_OPTIONS = [
  { value: 'allow', label: '自动执行' },
  { value: 'ask', label: '每次询问' },
  { value: 'deny', label: '禁止调用' },
]

function toggleTool(index) {
  const updated = props.tools.map((tool, i) => i === index
    ? { ...tool, enabled: !tool.enabled, permission: !tool.enabled ? 'ask' : 'deny' }
    : tool)
  emit('update:tools', updated)
}

function updatePermission(index, permission) {
  const updated = props.tools.map((tool, i) => i === index
    ? { ...tool, permission, enabled: permission !== 'deny' }
    : tool)
  emit('update:tools', updated)
}
</script>

<template>
  <section class="tools-settings" aria-label="工具管理">
    <header class="tools-head">
      <p>控制每个工具是否可用，以及调用前是否需要先问你。</p>
    </header>

    <div class="settings-list">
      <div v-for="(tool, index) in props.tools" :key="tool.name" class="settings-row">
        <div class="settings-row__copy">
          <strong>{{ tool.title || tool.name }}</strong>
          <small>{{ kindLabel(tool) }}</small>
        </div>
        <div class="settings-row__control">
          <KimaSelect
            class="settings-row__select"
            :model-value="tool.permission"
            :items="PERMISSION_OPTIONS"
            :label="`${tool.name} 权限`"
            @update:model-value="updatePermission(index, $event)"
          />
          <Switch
            hide-label
            :model-value="tool.enabled"
            :label="`切换 ${tool.name}`"
            @update:model-value="toggleTool(index)"
          />
        </div>
      </div>
      <p v-if="!props.tools.length" class="tools-settings__empty">暂无可配置的工具</p>
    </div>
  </section>
</template>

<style scoped lang="scss">
.tools-settings { display: flex; min-height: 0; flex-direction: column; gap: 20px; }
.tools-head p {
  margin: 0;
  color: var(--la-muted);
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
}
.settings-list {
  padding-inline: 24px;
  border-radius: 20px;
  background: var(--la-layer-01);
}
.settings-row {
  display: flex;
  min-height: 96px;
  align-items: center;
  gap: 24px;
  padding-block: 16px;
  border-bottom: .5px solid var(--la-line);

  &:last-child { border-bottom: 0; }
}
.settings-row__copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 4px; }
.settings-row__copy strong { color: var(--la-text); font-size: 16px; font-weight: 600; line-height: 24px; }
.settings-row__copy small { color: var(--la-muted); font-size: 14px; font-weight: 400; line-height: 20px; }
.settings-row__control { display: flex; flex: none; align-items: center; gap: 20px; }
.settings-row__select { width: 176px; }
.tools-settings__empty { margin: 0; padding: 32px 0; color: var(--la-muted); text-align: center; font-size: 14px; }
@media (max-width: 767px) {
  .settings-row { flex-wrap: wrap; gap: 12px; padding-block: 20px; }
  .settings-row__control { width: 100%; justify-content: space-between; }
  .settings-row__select { width: auto; flex: 1; }
}
</style>
