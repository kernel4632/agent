<!--
MCP 服务页：默认是服务列表；点一行进入该服务的编辑页。
列表和编辑页共用 draft.mcp，保存仍由设置页自动完成；本机识别和连接测试走 /mcp/*。
调用示例：<MCPList :draft="draft" :detail="detail" @open-detail="..." @close-detail="..." @update-detail-title="..." />
-->
<script setup>
import { computed, onMounted, ref } from 'vue'
import Icon from '../../ui/Icon.vue'
import Button from '../../ui/Button.vue'
import SelectButton from '../../ui/SelectButton.vue'      // 自有选择控件，替代原生 checkbox
import Switch from '../../ui/Switch.vue'                  // 识别项的添加/移除状态用开关表达
import MCPEditor from './MCPEditor.vue'
import { Mcp, describeTarget } from '../../commands/mcp.js'
import { Settings } from '../../commands/settings.js'

const props = defineProps({
  draft: { type: Object, required: true },
  detail: { type: Object, default: null },
})
const emit = defineEmits(['open-detail', 'close-detail', 'update-detail-title'])

const detected = ref({ sources: [], servers: [] })
// 后端报的“这个服务现在起不来”的原因，键是服务名。
// 配置里没有这个信息：启动失败是运行时的，存不存得起取决于当次进程。
const failed = ref({})
const detecting = ref(true)
const importBusy = ref('')                                // 单项导入中的服务 id
const testState = ref(null)

// --- 批量选择状态：键是识别服务的 id，值是是否勾选 ---
const checked = ref({})
const bulkBusy = ref(false)                               // 批量导入进行中，按钮置灰
const candidateIds = computed(() => candidates.value.map(server => server.id))
const selectedIds = computed(() => candidateIds.value.filter(id => checked.value[id] && !candidates.value.find(server => server.id === id).configured))
const allChecked = computed(() => candidateIds.value.length > 0 && candidateIds.value.every(id => checked.value[id]))
const someChecked = computed(() => candidateIds.value.some(id => checked.value[id]))

// 全选按钮的三态：全选 → 勾；部分 → 半选；没选 → 空。
const bulkState = computed(() => ({
  modelValue: allChecked.value,
  indeterminate: !allChecked.value && someChecked.value,
  disabled: detecting.value || !candidateIds.value.length,
}))

function toggleAll(value) {
  const next = {}                                          // 重建整个勾选表，避免残留已删项
  for (const id of candidateIds.value) next[id] = value
  checked.value = next
}

function toggleOne(id, value) {
  checked.value = { ...checked.value, [id]: value }        // 单项切换，保持响应式更新
}

// 批量导入：先落盘当前草稿，再按上限切片提交，最后刷新配置与识别结果。
async function bulkImport() {
  const ids = selectedIds.value
  if (!ids.length) return                                  // 没勾选时按钮本身已置灰，这里再拦一道
  bulkBusy.value = true
  try {
    const saved = await Settings.save({ keepDraft: true }) // 执行前确保草稿已落盘，避免保存时回跳
    if (!saved) return
    const result = await Mcp.importMany(ids)               // 内部按 50/片切片提交
    if (!result) return
    await Settings.refreshMcp()                            // 接口响应后同步草稿，防止旧草稿覆盖回跳
    for (const server of candidates.value) {               // 草稿同步后再刷新识别结果里的状态
      if (result.imported.includes(server.name)) server.configured = true
    }
    checked.value = {}                                     // 已处理的勾选清空，避免下次误操作
  } finally {
    bulkBusy.value = false
  }
}

const selected = computed(() => props.detail
  ? props.draft.mcp.find(item => item.id === props.detail.id) ?? null
  : null)
const candidates = computed(() => detected.value.servers || [])

// --- 打开页面时扫一遍本机，不需要用户先点“扫描” ---
async function loadDetected() {
  detecting.value = true
  const catalog = await Mcp.load()
  if (catalog) {
    detected.value = catalog.detected                          // 本机识别到的、可以导入的服务
    // 已配置服务的连接失败原因：让用户看得到“它现在起不来”，而不是工具默默没了
    failed.value = Object.fromEntries(
      (catalog.servers || []).filter(server => server.error).map(server => [server.name, server.error]),
    )
  }
  detecting.value = false
}
onMounted(loadDetected)

function addMCP() {
  let number = props.draft.mcp.length + 1
  while (props.draft.mcp.some(item => item.name === `MCP ${number}`)) number += 1
  const item = {
    id: crypto.randomUUID(),
    name: `MCP ${number}`,
    command: '',
    enabled: true,
    definition: { transport: 'stdio', args: [], env: {} },
  }
  props.draft.mcp.push(item)
  emit('open-detail', { id: item.id, title: item.name })
}

function updateMCP(updated) {
  const items = props.draft.mcp
  const index = items.findIndex(item => item.id === updated.id)
  if (index < 0) return
  items[index] = updated
  if (props.detail?.id === updated.id) emit('update-detail-title', updated.name)
}

function removeMCP() {
  const items = props.draft.mcp
  const index = items.findIndex(item => item.id === props.detail?.id)
  if (index >= 0) items.splice(index, 1)
  emit('close-detail')
}

// --- 导入一个识别到的服务；服务端写进配置后刷新草稿里的 mcp，不动其他字段 ---
async function importServer(server) {
  importBusy.value = server.id
  const saved = await Settings.save({ keepDraft: true })   // 导入前先落盘草稿，避免保存时覆盖
  const result = saved ? await Mcp.importServers([server.id]) : null
  importBusy.value = ''
  if (!result?.imported?.length) return
  await Settings.refreshMcp()                              // 响应后同步草稿，避免旧草稿回跳
  server.configured = true                                 // 开关状态实时同步
  checked.value = { ...checked.value, [server.id]: false } // 清掉这一项的勾选
}

// --- 已添加服务的开关：开 = 启用，关 = 仅从本应用配置停用，不改外部文件 ---
async function toggleConfigured(server, enabled) {
  const item = draft.mcp.find(entry => entry.name === server.name)
  if (!item) return
  item.enabled = enabled                                   // 先改草稿，设置页的自动保存会提交
  await Settings.save({ keepDraft: true })                 // 立即落盘，保证开关状态与配置一致
}

// --- 连接测试前先把草稿落盘，测的才是用户正在看的这套配置 ---
async function testServer() {
  const item = selected.value
  if (!item) return
  testState.value = { name: item.name, state: 'running', text: '正在连接…' }
  const saved = await Settings.save({ keepDraft: true })
  if (!saved) {
    testState.value = { name: item.name, state: 'error', text: '保存失败，先修好配置再测试。' }
    return
  }
  const result = await Mcp.test(item.name)
  if (!result) {
    testState.value = { name: item.name, state: 'error', text: '测试请求失败。' }
    return
  }
  testState.value = result.ok
    ? { name: item.name, state: 'ok', text: `连接成功，${result.tools.length} 个工具${result.tools.length ? `：${result.tools.slice(0, 6).join('、')}` : ''}` }
    : { name: item.name, state: 'error', text: result.error || '连接失败' }
}
</script>

<template>
  <section v-if="!detail" class="mcp-list" aria-label="MCP 服务">
    <header class="mcp-list__head">
      <p>连接外部工具服务，让模型可以调用浏览器、数据库或其他本地能力。</p>
      <Button @click="addMCP()"><Icon name="plus" :size="18" />添加服务</Button>
    </header>

    <div v-if="draft.mcp.length" class="mcp-list__card">
      <Button
        v-for="item in draft.mcp"
        :key="item.id"
        variant="plain"
        class="mcp-row"
        @click="emit('open-detail', { id: item.id, title: item.name })"
      >
        <span class="mcp-row__icon" aria-hidden="true"><Icon name="link" :size="20" /></span>
        <span class="mcp-row__copy">
          <strong>{{ item.name }}</strong>
          <!-- 起不来时直接把原因写在命令下面：用户不用去别处找 -->
          <small v-if="failed[item.name]" class="mcp-row__error">连接失败：{{ failed[item.name] }}</small>
          <small v-else>{{ item.command || '未配置命令或地址' }}</small>
        </span>
        <span class="mcp-row__state" :class="{ 'is-on': item.enabled }">{{ failed[item.name] ? '连接失败' : item.enabled ? '已启用' : '已停用' }}</span>
        <Icon name="arrow" :size="16" class="mcp-row__arrow" aria-hidden="true" />
      </Button>
    </div>

    <p v-else class="mcp-list__empty">还没有 MCP 服务。先添加一个外部工具服务。</p>

    <section class="mcp-detected" aria-label="本机识别到的 MCP 服务">
      <header class="mcp-detected__head">
        <div>
          <h2>本机识别到的服务</h2>
          <p>从其他软件的配置里读到；打开开关即写进本应用，不会修改源文件。</p>
        </div>
        <Button variant="text" :disabled="detecting" @click="loadDetected"><Icon name="refresh" :size="18" />重新扫描</Button>
      </header>

      <!-- 吸顶批量操作条：全选、已选计数、取消选择、批量开启 -->
      <div v-if="candidateIds.length && !detecting" class="mcp-bulk">
        <SelectButton
          :model-value="bulkState.modelValue"
          :indeterminate="bulkState.indeterminate"
          :disabled="bulkState.disabled"
          label="全选识别到的服务"
          @update:model-value="toggleAll"
        />
        <span class="mcp-bulk__count">已选 {{ selectedIds.length }} 项</span>
        <span class="mcp-bulk__spacer"></span>
        <Button variant="text" :disabled="!selectedIds.length || bulkBusy" @click="checked = {}">取消选择</Button>
        <Button :disabled="!selectedIds.length || bulkBusy" @click="bulkImport">
          <Icon name="plus" :size="18" />{{ bulkBusy ? '导入中…' : `批量添加 ${selectedIds.length || ''}` }}
        </Button>
      </div>

      <p v-if="detecting" class="mcp-detected__empty">正在扫描本机配置…</p>
      <p v-else-if="!candidates.length" class="mcp-detected__empty">没有发现可导入的 MCP 配置。</p>
      <div v-else class="mcp-detected__card">
        <div v-for="server in candidates" :key="server.id" class="mcp-detected__row">
          <SelectButton
            v-if="!server.configured"
            :model-value="Boolean(checked[server.id])"
            :label="`选择 ${server.name}`"
            @update:model-value="toggleOne(server.id, $event)"
          />
          <span class="mcp-detected__copy">
            <strong>{{ server.name }}</strong>
            <small>{{ server.app }} · {{ describeTarget(server.definition) }}</small>
            <small v-if="server.envKeys.length || server.headerKeys.length">
              导入后需要填写：{{ [...server.envKeys, ...server.headerKeys].join('、') }}（值不显示）
            </small>
          </span>
          <!-- 已添加的服务用开关表达；关掉只停用本应用配置，不碰源文件 -->
          <Switch
            v-if="server.configured"
            :model-value="draft.mcp.find(item => item.name === server.name)?.enabled ?? true"
            :label="`启用 ${server.name}`"
            hide-label
            @update:model-value="toggleConfigured(server, $event)"
          />
          <Switch
            v-else
            :model-value="false"
            :label="`添加 ${server.name}`"
            :disabled="importBusy === server.id || bulkBusy"
            hide-label
            @update:model-value="importServer(server)"
          />
        </div>
      </div>
    </section>
  </section>

  <div v-else-if="selected" :key="selected.id" class="mcp-detail">
    <MCPEditor :item="selected" :test-state="testState" @update="updateMCP" @delete="removeMCP" @test="testServer" />
  </div>

  <div v-else class="mcp-missing">
    <p>这个 MCP 服务已经不存在了。</p>
    <Button @click="emit('close-detail')">返回服务列表</Button>
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/capabilities/MCPList.scss"></style>
