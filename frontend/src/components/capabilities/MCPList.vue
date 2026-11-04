<!--
MCP 服务页：默认是服务列表；点一行进入该服务的编辑页。
列表和编辑页共用 draft.mcp，保存仍由设置页自动完成；本机识别和连接测试走 /mcp/*。
调用示例：<MCPList :draft="draft" :detail="detail" @open-detail="..." @close-detail="..." @update-detail-title="..." />
-->
<script setup>
import { computed, onMounted, ref } from 'vue'
import Icon from '../../ui/Icon.vue'
import Button from '../../ui/Button.vue'
import MCPEditor from './MCPEditor.vue'
import { Mcp, describeTarget } from '../../commands/mcp.js'
import { Settings } from '../../commands/settings.js'

const props = defineProps({
  draft: { type: Object, required: true },
  detail: { type: Object, default: null },
})
const emit = defineEmits(['open-detail', 'close-detail', 'update-detail-title'])

const detected = ref({ sources: [], servers: [] })
const detecting = ref(true)
const importBusy = ref('')
const testState = ref(null)

const selected = computed(() => props.detail
  ? props.draft.mcp.find(item => item.id === props.detail.id) ?? null
  : null)
const candidates = computed(() => detected.value.servers || [])

// --- 打开页面时扫一遍本机，不需要用户先点“扫描” ---
async function loadDetected() {
  detecting.value = true
  const catalog = await Mcp.load()
  if (catalog) detected.value = catalog.detected
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
  const result = await Mcp.importServers([server.id])
  importBusy.value = ''
  if (!result?.imported?.length) return
  await Settings.refreshMcp()
  await loadDetected()
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
          <small>{{ item.command || '未配置命令或地址' }}</small>
        </span>
        <span class="mcp-row__state" :class="{ 'is-on': item.enabled }">{{ item.enabled ? '已启用' : '已停用' }}</span>
        <Icon name="arrow" :size="16" class="mcp-row__arrow" aria-hidden="true" />
      </Button>
    </div>

    <p v-else class="mcp-list__empty">还没有 MCP 服务。先添加一个外部工具服务。</p>

    <section class="mcp-detected" aria-label="本机识别到的 MCP 服务">
      <header class="mcp-detected__head">
        <div>
          <h2>本机识别到的服务</h2>
          <p>从其他软件的配置里读到；点添加才写进本应用，不会修改源文件。</p>
        </div>
        <Button variant="text" :disabled="detecting" @click="loadDetected"><Icon name="refresh" :size="18" />重新扫描</Button>
      </header>

      <p v-if="detecting" class="mcp-detected__empty">正在扫描本机配置…</p>
      <p v-else-if="!candidates.length" class="mcp-detected__empty">没有发现可导入的 MCP 配置。</p>
      <div v-else class="mcp-detected__card">
        <div v-for="server in candidates" :key="server.id" class="mcp-detected__row">
          <span class="mcp-detected__copy">
            <strong>{{ server.name }}</strong>
            <small>{{ server.app }} · {{ describeTarget(server.definition) }}</small>
            <small v-if="server.envKeys.length || server.headerKeys.length">
              导入后需要填写：{{ [...server.envKeys, ...server.headerKeys].join('、') }}（值不显示）
            </small>
          </span>
          <span v-if="server.configured" class="mcp-detected__state">已添加</span>
          <Button v-else variant="text" :disabled="importBusy === server.id" @click="importServer(server)">
            {{ importBusy === server.id ? '添加中…' : '添加' }}
          </Button>
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
