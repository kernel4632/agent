<!--
MCP 服务管理：展示已配置的 MCP 服务连接，支持新增、编辑、删除和启用/禁用。
设计思想：左侧列表选择，右侧编辑面板修改详情，与供应商配置保持一致的交互模式。
核心数据：mcp（MCP 配置数组，每项含 id、name、command、enabled、definition）。
调用示例：<MCPSettings v-model:mcp="settingsDraft.mcp" />。
-->
<script setup>
import { computed, ref, watch } from 'vue'                  // 引入响应式状态、计算和监听

const props = defineProps({
  mcp: { type: Array, required: true },                     // 接收 MCP 配置数组（双向绑定）
})
const emit = defineEmits(['update:mcp'])                     // 输出变更后的 MCP 数组

const selectedID = ref(props.mcp[0]?.id ?? '')              // 默认选中首个 MCP 服务
const selectedItem = computed(() => props.mcp.find(item => item.id === selectedID.value) ?? null) // 选中项完整对象


// --- 新增 MCP 服务 ---
function addMCP() {
  const item = {
    id: `mcp-${crypto.randomUUID().slice(0, 8)}`,           // 生成短 ID 标识新服务
    name: `MCP ${props.mcp.length + 1}`,                    // 使用序号生成默认名称
    command: '',                                             // 等待用户填写启动命令
    enabled: false,                                          // 新建默认关闭，避免误启动
    definition: { transport: 'stdio', args: [], env: {} },  // stdio 是最常见的 MCP 传输方式
  }
  emit('update:mcp', [...props.mcp, item])                  // 新服务追加到数组末尾
  selectedID.value = item.id                                // 添加后立即选中进入编辑
}


// --- 删除选中的 MCP 服务 ---
function removeMCP() {
  const updated = props.mcp.filter(item => item.id !== selectedID.value) // 从列表中过滤目标
  emit('update:mcp', updated)                               // 上抛删除后的数组
}


// --- 修改选中 MCP 的字段 ---
function updateField(field, value) {
  const updated = props.mcp.map(item => item.id === selectedID.value
    ? { ...item, [field]: value }                           // 只替换目标字段
    : item)
  emit('update:mcp', updated)                               // 完整数组上抛
}


// --- 修改 MCP 的 definition 子字段 ---
function updateDefinition(field, value) {
  const updated = props.mcp.map(item => item.id === selectedID.value
    ? { ...item, definition: { ...item.definition, [field]: value } }
    : item)
  emit('update:mcp', updated)                               // 完整数组上抛
}


// --- 切换启用状态 ---
function toggleEnabled() {
  if (!selectedItem.value) return
  updateField('enabled', !selectedItem.value.enabled)       // 反转当前启用状态
}


// --- 尝试更新环境变量（JSON 不完整时不更新）---
function tryUpdateEnv(text) {
  try {
    const env = JSON.parse(text)                             // 解析用户输入的 JSON
    if (typeof env === 'object' && env !== null) {
      updateDefinition('env', env)                           // JSON 合法时写入草稿
    }
  } catch { /* JSON 不完整时不更新，等用户输入完整 */ }
}


// --- 删除后回退选择 ---
watch(() => props.mcp, (items) => {
  if (items.some(item => item.id === selectedID.value)) return // 当前选择仍存在
  selectedID.value = items[0]?.id ?? ''                     // 回退到首项
})
</script>

<template>
  <section class="mcp-settings">
    <!-- 顶部标题栏：标题计数和添加按钮。 -->
    <header class="mcp-settings__header">
      <div>
        <m3e-heading variant="headline" size="small" level="2">MCP 管理</m3e-heading>
        <span>{{ props.mcp.length }} 个服务</span>
      </div>
      <m3e-button type="button" variant="filled" @click="addMCP">
        <m3e-icon slot="icon" name="add" filled="1"></m3e-icon>
        添加服务
      </m3e-button>
    </header>

    <!-- 主体双栏：左侧列表，右侧编辑。 -->
    <div class="mcp-settings__body">
      <!-- 左侧 MCP 列表。 -->
      <aside class="mcp-settings__list" aria-label="MCP 服务列表">
        <m3e-action-list class="mcp-settings__items" aria-label="MCP 服务">
          <m3e-list-action
            v-for="item in props.mcp"
            :key="item.id"
            class="mcp-settings__list-item"
            :class="{ 'is-selected': item.id === selectedID }"
            @click="selectedID = item.id"
          >
            <span class="mcp-settings__name">{{ item.name }}</span>
            <span slot="supporting-text" class="mcp-settings__command">{{ item.command || '未配置命令' }}</span>
            <span slot="trailing" class="mcp-settings__state" :class="{ 'is-enabled': item.enabled }">
              {{ item.enabled ? '启用' : '停用' }}
            </span>
          </m3e-list-action>
        </m3e-action-list>
      </aside>

      <!-- 右侧编辑面板。 -->
      <div class="mcp-settings__editor">
        <form v-if="selectedItem" class="mcp-settings__form" @submit.prevent>
          <!-- 名称和启用状态。 -->
          <header class="mcp-settings__title-row">
            <m3e-form-field class="mcp-settings__field-name" variant="outlined" hide-subscript="always">
              <label slot="label">服务名称</label>
              <input :value="selectedItem.name" @input="updateField('name', $event.currentTarget.value)" />
            </m3e-form-field>
            <label class="mcp-settings__enabled">
              <span>{{ selectedItem.enabled ? '已启用' : '已停用' }}</span>
              <m3e-switch :checked="selectedItem.enabled" @change="toggleEnabled"></m3e-switch>
            </label>
          </header>

          <!-- 传输方式选择。 -->
          <section class="mcp-settings__section">
            <m3e-form-field variant="outlined" hide-subscript="always">
              <label slot="label">传输方式</label>
              <m3e-select :value="selectedItem.definition?.transport || 'stdio'" @change="updateDefinition('transport', $event.currentTarget.value)">
                <m3e-option value="stdio">stdio（标准输入输出）</m3e-option>
                <m3e-option value="sse">SSE（HTTP 流）</m3e-option>
              </m3e-select>
            </m3e-form-field>
          </section>

          <!-- 启动命令。 -->
          <section class="mcp-settings__section">
            <m3e-form-field class="mcp-settings__field-full" variant="outlined" hide-subscript="always">
              <label slot="label">{{ selectedItem.definition?.transport === 'sse' ? '服务地址（URL）' : '启动命令' }}</label>
              <input
                :value="selectedItem.command"
                :placeholder="selectedItem.definition?.transport === 'sse' ? 'http://localhost:3000/sse' : 'npx @modelcontextprotocol/server-xxx'"
                @input="updateField('command', $event.currentTarget.value)"
              />
            </m3e-form-field>
          </section>

          <!-- 启动参数（仅 stdio）。 -->
          <section v-if="selectedItem.definition?.transport !== 'sse'" class="mcp-settings__section">
            <m3e-form-field class="mcp-settings__field-full" variant="outlined" hide-subscript="always">
              <label slot="label">启动参数（每行一个）</label>
              <textarea
                :value="(selectedItem.definition?.args || []).join('\n')"
                rows="3"
                placeholder="--port&#10;3000"
                @input="updateDefinition('args', $event.currentTarget.value.split('\n').filter(Boolean))"
              ></textarea>
            </m3e-form-field>
          </section>

          <!-- 环境变量（仅 stdio）。 -->
          <section v-if="selectedItem.definition?.transport !== 'sse'" class="mcp-settings__section">
            <m3e-form-field class="mcp-settings__field-full" variant="outlined" hide-subscript="always">
              <label slot="label">环境变量（JSON 格式）</label>
              <textarea
                :value="JSON.stringify(selectedItem.definition?.env || {}, null, 2)"
                rows="4"
                placeholder='{"API_KEY": "xxx"}'
                @input="tryUpdateEnv($event.currentTarget.value)"
              ></textarea>
            </m3e-form-field>
          </section>

          <!-- 删除按钮。 -->
          <section class="mcp-settings__actions">
            <m3e-button type="button" variant="outlined" @click="removeMCP">
              <m3e-icon slot="icon" name="delete" filled="1"></m3e-icon>
              删除此服务
            </m3e-button>
          </section>
        </form>

        <!-- 无选中态。 -->
        <div v-else class="mcp-settings__empty">
          <span>添加一个 MCP 服务以开始配置</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
/* --- MCP 管理主容器 --- */
.mcp-settings {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

/* --- 顶部标题栏 --- */
.mcp-settings__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  gap: 20px;
  padding: 26px 32px 22px;
  border-bottom: 1px solid #242424;
}

.mcp-settings__header > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mcp-settings__header span { color: #7f7f7f; font-size: 13px; }

/* --- 主体双栏 --- */
.mcp-settings__body {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
}

/* --- 左侧列表 --- */
.mcp-settings__list {
  display: flex;
  flex: 0 0 236px;
  flex-direction: column;
  min-height: 0;
  padding: 12px 14px 20px;
  border-right: 1px solid #242424;
  background: #101010;
}

.mcp-settings__items {
  display: flex;
  overflow-x: hidden;
  overflow-y: auto;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
}

.mcp-settings__list-item {
  --m3e-list-item-container-color: transparent;
  --m3e-list-item-label-text-color: #b7b7b7;
  width: 100%;

  &.is-selected {
    --m3e-list-item-container-color: #2b2b2b;
    --m3e-list-item-label-text-color: #ffffff;
  }
}

.mcp-settings__name {
  min-width: 0;
  overflow: hidden;
  flex: 1 1 auto;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mcp-settings__command {
  display: block;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mcp-settings__state {
  color: #777777;
  font-size: 12px;
  &.is-enabled { color: #d3d3d3; }
}

/* --- 右侧编辑面板 --- */
.mcp-settings__editor {
  min-width: 0;
  overflow-y: auto;
  flex: 1 1 auto;
  @include scrollbar-dark;
}

.mcp-settings__form {
  display: flex;
  width: min(720px, 100%);
  margin: 0 auto;
  flex-direction: column;
  gap: 28px;
  padding: 36px 40px 72px;
}

/* --- 标题行 --- */
.mcp-settings__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.mcp-settings__field-name { width: min(360px, 100%); }

.mcp-settings__enabled {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 10px;
  color: #a6a6a6;
  font-size: 13px;
}

/* --- 表单分区 --- */
.mcp-settings__section { padding: 0; }
.mcp-settings__field-full { width: 100%; }

/* --- 操作按钮区 --- */
.mcp-settings__actions {
  padding-top: 12px;
  border-top: 1px solid #242424;
}

/* --- 空状态 --- */
.mcp-settings__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 420px;
  color: #777777;
}

/* --- 窄屏适配 --- */
@media (max-width: 680px) {
  .mcp-settings__header { align-items: flex-start; padding: 20px 16px; }
  .mcp-settings__body { flex-direction: column; }
  .mcp-settings__list {
    flex: none;
    width: 100%;
    padding: 8px 12px 12px;
    border-right: 0;
    border-bottom: 1px solid #242424;
  }
  .mcp-settings__items { overflow-x: auto; flex-direction: row; }
  .mcp-settings__list-item { min-width: 170px; }
  .mcp-settings__form { padding: 28px 22px 56px; }
  .mcp-settings__title-row { align-items: stretch; flex-direction: column; }
  .mcp-settings__editor { overflow: visible; }
}
</style>
