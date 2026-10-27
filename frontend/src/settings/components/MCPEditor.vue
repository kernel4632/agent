<!--
MCP 服务编辑页：编辑一个服务的传输方式、命令或地址、参数和环境变量。
所有字段通过 update 事件交回页面写进草稿；删除确认是本地临时状态。
调用示例：<MCPEditor :item="selected" @update="updateMCP" @delete="removeMCP" />
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { KimaSelect } from '@kernel4632/kima'
import { AppIcon, Button, Dialog, Field, Switch } from '../../ui/index.js'

const props = defineProps({ item: { type: Object, required: true } })
const emit = defineEmits(['update', 'delete'])

const TRANSPORT_OPTIONS = [
  { value: 'stdio', label: 'stdio（标准输入输出）' },
  { value: 'sse', label: 'SSE（HTTP 流）' },
  { value: 'http', label: 'HTTP（流）' },
]

const remote = computed(() => ['sse', 'http'].includes(props.item.definition?.transport))
const deleteOpen = ref(false)
const envError = ref('')                              // 环境变量 JSON 写错时的可见原因
const envText = ref('')                               // 编辑中的原始文本；写错时也要留在输入框里
const envDirty = ref(false)                           // 用户改过但还没解析成功，不能被自动保存或其它字段刷新覆盖

const update = patch => emit('update', { ...props.item, ...patch })
const updateDefinition = patch => emit('update', { ...props.item, definition: { ...props.item.definition, ...patch } })

function tryUpdateEnv(text) {
  envText.value = text                                // 先留住用户正在输入的内容，解析失败也不回退
  envDirty.value = true                               // 在解析成功前，任何外部刷新都不能覆盖这段草稿
  try {
    const env = JSON.parse(text)
    if (typeof env !== 'object' || env === null || Array.isArray(env)) throw new Error('必须是 JSON 对象')
    envDirty.value = false
    envError.value = ''
    updateDefinition({ env })
  } catch (error) {
    // 保留上一次有效值，只把原因显示在输入框下方；不要静默吞掉。
    envError.value = `环境变量必须是 JSON 对象：${error.message}`
  }
}

// 换服务或外部真的改了 env 时才重写草稿；用户还没解析成功的草稿不能被覆盖。
function resetEnvDraft({ force = false } = {}) {
  if (!force && envDirty.value) return
  envText.value = JSON.stringify(props.item?.definition?.env || {}, null, 2)
  envError.value = ''
  envDirty.value = false
}
watch(() => props.item.id, () => resetEnvDraft({ force: true }), { immediate: true })
watch(() => props.item?.definition?.env, () => resetEnvDraft(), { deep: true })
</script>

<template>
  <form class="mcp-form" @submit.prevent>
    <header class="mcp-form__head">
      <h3>{{ item.name }}</h3>
      <Switch :model-value="item.enabled" label="启用此服务" @update:model-value="update({ enabled: $event })" />
    </header>

    <Field caption="服务名称" :model-value="item.name" @update:model-value="update({ name: $event })" />

    <div class="mcp-field">
      <span class="mcp-field__caption">传输方式</span>
      <KimaSelect
        label="传输方式"
        :model-value="item.definition?.transport || 'stdio'"
        :items="TRANSPORT_OPTIONS"
        @update:model-value="updateDefinition({ transport: $event })"
      />
    </div>

    <Field
      :caption="remote ? '服务地址（URL）' : '启动命令'"
      :model-value="item.command"
      :placeholder="remote ? 'http://localhost:3000/sse' : 'npx @modelcontextprotocol/server-xxx'"
      @update:model-value="update({ command: $event })"
    />

    <Field
      v-if="!remote"
      caption="启动参数（每行一个）"
      multiline
      :rows="3"
      :model-value="(item.definition?.args || []).join('\n')"
      placeholder="--port&#10;3000"
      @update:model-value="updateDefinition({ args: $event.split('\n').filter(Boolean) })"
    />

    <Field
      v-if="!remote"
      caption="环境变量（JSON 格式）"
      multiline
      :rows="4"
      :model-value="envText"
      placeholder='{"API_KEY": "xxx"}'
      @update:model-value="tryUpdateEnv"
    />
    <p v-if="!remote && envError" class="mcp-env-error" role="alert">{{ envError }}</p>

    <footer class="mcp-actions">
      <Button variant="danger" @click="deleteOpen = true"><AppIcon name="trash" :size="18" />删除此服务</Button>
    </footer>
  </form>

  <Dialog :open="deleteOpen" label="删除 MCP 服务" @update:open="deleteOpen = $event">
    <p>删除后会自动保存，这个 MCP 服务会从列表中移除。</p>
    <div class="dialog-actions">
      <Button @click="deleteOpen = false">取消</Button>
      <Button variant="danger" @click="deleteOpen = false; emit('delete')">删除</Button>
    </div>
  </Dialog>
</template>

<style scoped lang="scss">
.mcp-form {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 24px;
  padding: 24px;
  border-radius: 20px;
  background: var(--la-layer-01);
}
.mcp-form__head { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.mcp-form__head h3 { margin: 0; color: var(--la-text); font-size: 18px; font-weight: 600; line-height: 26px; }
/* KIMA Select 只画控件，不画可见标题；标题留给页面排版，避免和 aria-label 重复。 */
.mcp-field { display: grid; gap: 8px; }
.mcp-field__caption { color: var(--kima-color-on-surface-variant); font-size: 14px; font-weight: 500; line-height: 20px; }
.mcp-env-error { margin: -4px 0 0; color: var(--kima-color-error); font-size: 13px; line-height: 20px; }
.mcp-actions { padding-top: 20px; border-top: .5px solid var(--la-line); }
@media (max-width: 767px) {
  .mcp-form { padding: 20px; }
  .mcp-form__head { flex-wrap: wrap; }
}
</style>
