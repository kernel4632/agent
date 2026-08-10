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


// --- 权限级别对应的显示文案 ---
const permissionLabels = {
  allow: '自动执行',                                          // 工具调用无需用户确认
  ask: '每次询问',                                            // 每次调用需要用户审批
  deny: '禁止调用',                                           // 完全禁用此工具
}


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
  <section class="tools-settings">
    <!-- 顶部标题栏。 -->
    <header class="tools-settings__header">
      <div>
        <m3e-heading variant="headline" size="small" level="2">工具管理</m3e-heading>
        <span>{{ props.tools.length }} 个工具</span>
      </div>
    </header>

    <!-- 工具列表。 -->
    <div class="tools-settings__body">
      <div class="tools-settings__list">
        <div v-for="(tool, index) in props.tools" :key="tool.name" class="tools-settings__item">
          <!-- 左侧：工具名和权限选择。 -->
          <div class="tools-settings__identity">
            <strong>{{ tool.title || tool.name }}</strong>
            <m3e-select
              class="tools-settings__permission"
              :value="tool.permission"
              @change="updatePermission(index, $event.currentTarget.value)"
            >
              <m3e-option value="allow">自动执行</m3e-option>
              <m3e-option value="ask">每次询问</m3e-option>
              <m3e-option value="deny">禁止调用</m3e-option>
            </m3e-select>
          </div>
          <!-- 右侧：启用开关。 -->
          <m3e-switch
            :checked="tool.enabled"
            @change="toggleTool(index)"
          ></m3e-switch>
        </div>
        <p v-if="!props.tools.length" class="tools-settings__empty">暂无可配置的工具</p>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
/* --- 工具管理主容器 --- */
.tools-settings {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

/* --- 顶部标题栏 --- */
.tools-settings__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  gap: 20px;
  padding: 26px 32px 22px;
  border-bottom: 1px solid #242424;
}

.tools-settings__header > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tools-settings__header span { color: #7f7f7f; font-size: 13px; }

/* --- 列表区域 --- */
.tools-settings__body {
  overflow-y: auto;
  flex: 1 1 auto;
  padding: 24px 32px 48px;
  @include scrollbar-dark;
}

.tools-settings__list {
  display: flex;
  width: min(720px, 100%);
  margin: 0 auto;
  flex-direction: column;
  gap: 6px;
}

/* --- 单行工具 --- */
.tools-settings__item {
  display: flex;
  align-items: center;
  min-height: 56px;
  gap: 16px;
  padding: 12px 16px;
  border: 1px solid #303030;
  border-radius: 8px;
}

/* --- 工具身份区 --- */
.tools-settings__identity {
  display: flex;
  min-width: 0;
  align-items: center;
  flex: 1 1 auto;
  gap: 16px;
}

.tools-settings__identity strong {
  min-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* --- 权限选择器 --- */
.tools-settings__permission {
  width: 140px;
  flex: 0 0 auto;
}

/* --- 空状态 --- */
.tools-settings__empty {
  margin: 0;
  padding: 32px;
  border: 1px dashed #333333;
  border-radius: 8px;
  color: #777777;
  text-align: center;
}

/* --- 移动端适配 --- */
@media (max-width: 760px) {
  .tools-settings__body { padding: 20px 16px 40px; }
  .tools-settings__identity { flex-direction: column; align-items: flex-start; gap: 8px; }
}
</style>
