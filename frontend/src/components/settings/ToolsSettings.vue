<!--
工具权限管理：展示 Agent 可调用的所有工具，支持启用/禁用和权限级别设置。
设计思想：工具列表由 Server 配置加载，每次修改立即写入草稿；保存由设置页统一触发。
核心数据：tools（工具配置数组，每项含 name、enabled、permission）。
调用示例：<ToolsSettings v-model:tools="settingsDraft.tools" />。
-->
<script setup>
const props = defineProps({
  tools: { type: Array, required: true },
})
const emit = defineEmits(['update:tools'])

const KIND_LABELS = { read: '读取', write: '写入', command: '执行命令', mcp: 'MCP', subtask: '子任务', other: '自定义' }
const kindLabel = tool => KIND_LABELS[tool.kind] || '工具'

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
    <div class="settings-list">
      <div v-for="(tool, index) in props.tools" :key="tool.name" class="settings-row">
        <div class="settings-row__copy">
          <strong>{{ tool.title || tool.name }}</strong>
          <small>{{ kindLabel(tool) }}</small>
        </div>
        <div class="settings-row__control">
          <select class="tool-select" :value="tool.permission" :aria-label="`${tool.name} 权限`" @change="updatePermission(index, $event.target.value)">
            <option value="allow">自动执行</option>
            <option value="ask">每次询问</option>
            <option value="deny">禁止调用</option>
          </select>
          <input class="switch" type="checkbox" role="switch" :aria-label="`切换 ${tool.name}`" :checked="tool.enabled" @change="toggleTool(index)" />
        </div>
      </div>
      <p v-if="!props.tools.length" class="tools-settings__empty">暂无可配置的工具</p>
    </div>
  </section>
</template>

<style scoped lang="scss">
.tools-settings { display: flex; min-height: 0; flex-direction: column; }
.settings-list {
  padding-inline: 20px;
  border-radius: 8px;
  background: var(--la-layer-01);
  box-shadow: inset 0 0 0 .5px var(--la-line);
}
.settings-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-block: 20px;
  border-bottom: .5px solid var(--la-line);

  &:last-child { border-bottom: 0; }
}
.settings-row__copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 4px; }
.settings-row__copy strong { color: var(--la-text); font-size: 13px; font-weight: 530; line-height: 16px; }
.settings-row__copy small { color: var(--la-muted); font-size: 13px; font-weight: 440; line-height: 20px; }
.settings-row__control { display: flex; flex: none; align-items: center; gap: 12px; }
.tool-select {
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: var(--la-layer-02);
  color: var(--la-text);
  font-size: 13px;
  cursor: pointer;
}
.tool-select:focus-visible { outline: 2px solid var(--la-accent-border); outline-offset: 2px; }
.tools-settings__empty { margin: 0; padding: 24px 0; color: var(--la-muted); text-align: center; font-size: 13px; }
@media (max-width: 767px) {
  .settings-row { flex-wrap: wrap; padding-block: 16px; }
  .settings-row__control { width: 100%; justify-content: space-between; }
}
</style>
