<!--
工具权限管理：展示 Agent 可调用的所有工具，支持启用/禁用和权限级别设置。
设计思想：工具列表由 Server 配置加载，每次修改立即写入草稿；保存由设置页统一触发。
核心数据：tools（工具配置数组，每项含 name、enabled、permission）。
调用示例：<ToolsSettings v-model:tools="settingsDraft.tools" />。
-->
<script setup>
const props = defineProps({
  tools: { type: Array, required: true },                   // 接收工具配置数组（双向绑定）
})
const emit = defineEmits(['update:tools'])                   // 输出变更后的工具数组


// --- 切换工具启用状态 ---
function toggleTool(index) {
  const updated = props.tools.map((tool, i) => i === index
    ? { ...tool, enabled: !tool.enabled, permission: !tool.enabled ? 'ask' : 'deny' } // 启用时默认为询问权限
    : tool)
  emit('update:tools', updated)                             // 完整数组上抛触发响应式更新
}


// --- 修改工具权限级别 ---
function updatePermission(index, permission) {
  const updated = props.tools.map((tool, i) => i === index
    ? { ...tool, permission, enabled: permission !== 'deny' } // deny 等价于禁用
    : tool)
  emit('update:tools', updated)                             // 完整数组上抛
}
</script>

<template>
  <m3e-content-pane class="tools-settings">
    <m3e-list class="tools-settings__list">
      <m3e-list-item v-for="(tool, index) in props.tools" :key="tool.name" class="tools-settings__item">
        {{ tool.title || tool.name }}
        <span slot="supporting-text">{{ tool.name }}</span>
        <div slot="trailing" class="tools-settings__controls">
          <m3e-form-field class="tools-settings__permission" variant="outlined" hide-subscript="always">
            <m3e-select @input="updatePermission(index, $event.currentTarget.value)">
              <m3e-option value="allow">自动执行</m3e-option>
              <m3e-option value="ask">每次询问</m3e-option>
              <m3e-option value="deny">禁止调用</m3e-option>
            </m3e-select>
          </m3e-form-field>
          <m3e-switch :checked="tool.enabled" @change="toggleTool(index)"></m3e-switch>
        </div>
      </m3e-list-item>
      <m3e-divider v-if="props.tools.length"></m3e-divider>
      <p v-if="!props.tools.length" class="tools-settings__empty">暂无可配置的工具</p>
    </m3e-list>
  </m3e-content-pane>
</template>

<style scoped lang="scss">
.tools-settings {
  display: flex;
  flex-direction: column;
  @include scrollbar-dark;
}

.tools-settings__list {
  display: flex;
  width: min(720px, 100%);
  margin: 0;
  flex-direction: column;
}

/* --- 单行工具 --- */
.tools-settings__item {
  width: 100%;
}
.tools-settings__controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* --- 权限选择器 --- */
.tools-settings__permission {
  width: 140px;
  flex: 0 0 auto;
}

/* --- 空状态 --- */
.tools-settings__empty {
  margin: 0;
  padding: 24px 16px;
  color: var(--md-sys-color-outline);
  text-align: center;
}

/* --- 移动端适配 --- */
@media (max-width: 760px) {
  .tools-settings__controls { gap: 8px; }
}
</style>
