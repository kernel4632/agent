<!--
MCP 服务管理：展示已配置的 MCP 服务连接，支持编辑、删除和启用/禁用。
设计思想：左侧列表选择，右侧编辑面板修改详情，与供应商配置保持一致的交互模式。
核心数据：mcp（MCP 配置数组，每项含 id、name、command、enabled、definition）。
调用示例：<MCPSettings v-model:mcp="settingsDraft.mcp" />。
-->
<script setup>
import { computed, ref, watch } from 'vue'                  // 引入响应式状态、计算和监听
import { HugeiconsIcon } from '@hugeicons/vue'
import { Delete01Icon } from '@hugeicons/core-free-icons'
import { ICON_STROKE_WIDTH } from '../../theme.js'

const props = defineProps({
  mcp: { type: Array, required: true },                     // 接收 MCP 配置数组（双向绑定）
})
const emit = defineEmits(['update:mcp'])                     // 输出变更后的 MCP 数组

const selectedID = ref(props.mcp[0]?.id ?? '')              // 默认选中首个 MCP 服务
const selectedItem = computed(() => props.mcp.find(item => item.id === selectedID.value) ?? null) // 选中项完整对象
const deleteDialog = ref(null)


function requestRemove() {
  deleteDialog.value.show()
}

function removeMCP() {
  const index = props.mcp.findIndex(item => item.id === selectedID.value)
  if (index < 0) return
  const nextItem = props.mcp[index + 1] ?? props.mcp[index - 1]
  emit('update:mcp', props.mcp.filter(item => item.id !== selectedID.value))
  selectedID.value = nextItem?.id ?? ''
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


// --- 外部新增条目时自动选择；删除时保留有效选择 ---
watch(() => props.mcp.map(item => item.id), (ids, previousIDs) => {
  const addedID = ids.find(id => !previousIDs.includes(id))
  if (addedID) selectedID.value = addedID
  else if (!ids.includes(selectedID.value)) selectedID.value = ids[0] ?? ''
})
</script>

<template>
  <section class="mcp-settings">
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
              <m3e-select @change="updateDefinition('transport', $event.currentTarget.value)">
                <m3e-option value="stdio" :selected="(selectedItem.definition?.transport || 'stdio') === 'stdio'">stdio（标准输入输出）</m3e-option>
                <m3e-option value="sse" :selected="selectedItem.definition?.transport === 'sse'">SSE（HTTP 流）</m3e-option>
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
            <m3e-button type="button" variant="outlined" @click="requestRemove">
              <HugeiconsIcon slot="icon" :icon="Delete01Icon" :stroke-width="ICON_STROKE_WIDTH" />
              删除此服务
            </m3e-button>
        </section>
      </form>

      <!-- 无选中态。 -->
      <div v-else class="mcp-settings__empty">
        <span>添加一个 MCP 服务以开始配置</span>
      </div>
    </div>

    <m3e-dialog ref="deleteDialog" dismissible aria-label="删除 MCP 服务确认">
      <m3e-heading slot="header" variant="headline" size="small" level="2">删除 MCP 服务？</m3e-heading>
      <p>此 MCP 服务的未保存配置将被移除。</p>
      <div slot="actions" class="mcp-settings__dialog-actions" end>
        <m3e-button type="button" shape="square"><m3e-dialog-action return-value="cancel">取消</m3e-dialog-action></m3e-button>
        <m3e-button type="button" variant="filled" shape="square" @click="removeMCP"><m3e-dialog-action return-value="delete">删除</m3e-dialog-action></m3e-button>
      </div>
    </m3e-dialog>
  </section>
</template>

<style scoped lang="scss">
/* --- MCP 管理主容器 --- */
.mcp-settings {
  display: flex;
}

/* --- 左侧列表 --- */
.mcp-settings__list {
  display: flex;
  flex: 0 0 236px;
  flex-direction: column;
  min-height: 0;
  padding: 12px 14px 20px;
  border-right: 1px solid var(--md-sys-color-outline-variant);
  background: var(--md-sys-color-surface);
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
  --m3e-list-item-label-text-color: var(--md-sys-color-on-surface-variant);
  width: 100%;

  &.is-selected {
    --m3e-list-item-container-color: var(--md-sys-color-surface-container-highest);
    --m3e-list-item-label-text-color: var(--md-sys-color-on-surface);
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
  color: var(--md-sys-color-outline);
  font-size: 12px;
  &.is-enabled { color: var(--md-sys-color-on-surface-variant); }
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
  color: var(--md-sys-color-outline);
  font-size: 13px;
}
.mcp-settings__section { padding: 0; }
.mcp-settings__field-full { width: 100%; }

/* --- 操作按钮区 --- */
.mcp-settings__actions {
  padding-top: 12px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
}

.mcp-settings__dialog-actions { display: flex; gap: 8px; }

/* --- 空状态 --- */
.mcp-settings__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 420px;
  color: var(--md-sys-color-outline);
}

/* --- 窄屏适配 --- */
@media (max-width: 680px) {
  .mcp-settings { flex-direction: column; }
  .mcp-settings__list {
    flex: none;
    width: 100%;
    padding: 8px 12px 12px;
    border-right: 0;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
  }
  .mcp-settings__items { overflow-x: auto; flex-direction: row; }
  .mcp-settings__list-item { min-width: 170px; }
  .mcp-settings__form { padding: 28px 22px 56px; }
  .mcp-settings__title-row { align-items: stretch; flex-direction: column; }
  .mcp-settings__editor { overflow: visible; }
}
</style>
