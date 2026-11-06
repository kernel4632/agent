<!--
MCP 服务编辑页：编辑一个服务的传输方式、命令或地址、参数和环境变量。
所有字段通过 update 事件交回页面写进草稿；删除确认是本地临时状态。
调用示例：<MCPEditor :item="selected" @update="updateMCP" @delete="removeMCP" />
-->
<script setup>
import { computed, ref, watch } from 'vue'
import Select from '../../ui/Select.vue'
import Icon from '../../ui/Icon.vue'
import Button from '../../ui/Button.vue'
import Dialog from '../../ui/Dialog.vue'
import Field from '../../ui/Field.vue'
import Switch from '../../ui/Switch.vue'
import SettingsList from '../../ui/SettingsList.vue'
import SettingsRow from '../../ui/SettingsRow.vue'

const props = defineProps({
  item: { type: Object, required: true },
  testState: { type: Object, default: null },
})
const emit = defineEmits(['update', 'delete', 'test'])

const TRANSPORT_OPTIONS = [
  { value: 'stdio', label: 'stdio（标准输入输出）' },
  { value: 'sse', label: 'SSE（HTTP 流）' },
  { value: 'http', label: 'HTTP（流）' },
]

const remote = computed(() => ['sse', 'http'].includes(props.item.definition?.transport))
// 测试结果只显示在它对应的服务上，切换服务时不串台。
const result = computed(() => props.testState?.name === props.item.name ? props.testState : null)
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
    <h3 class="sr-only">{{ item.name }}</h3>
    <SettingsList title="服务配置">
      <SettingsRow title="启用此服务" description="关闭后保留配置，但不会加载它的工具">
        <Switch :model-value="item.enabled" label="启用此服务" hide-label @update:model-value="update({ enabled: $event })" />
      </SettingsRow>
      <SettingsRow title="服务名称" description="用于在工具列表里识别这个服务">
        <Field class="mcp-control" label="服务名称" :model-value="item.name" @update:model-value="update({ name: $event })" />
      </SettingsRow>
      <SettingsRow title="传输方式" description="stdio 使用本机命令，SSE / HTTP 使用服务地址">
        <Select
          class="mcp-control"
          label="传输方式"
          :model-value="item.definition?.transport || 'stdio'"
          :items="TRANSPORT_OPTIONS"
          @update:model-value="updateDefinition({ transport: $event })"
        />
      </SettingsRow>
      <SettingsRow :title="remote ? '服务地址' : '启动命令'" :description="remote ? 'MCP 服务的 SSE 或 HTTP 地址' : '启动 MCP 服务的命令'">
        <Field
          class="mcp-control"
          :label="remote ? '服务地址（URL）' : '启动命令'"
          :model-value="item.command"
          :placeholder="remote ? 'http://localhost:3000/sse' : 'npx @modelcontextprotocol/server-xxx'"
          @update:model-value="update({ command: $event })"
        />
      </SettingsRow>
      <SettingsRow v-if="!remote" title="启动参数" description="每行一个参数" wide>
        <Field
          label="启动参数（每行一个）"
          multiline
          :rows="3"
          :model-value="(item.definition?.args || []).join('\n')"
          placeholder="--port&#10;3000"
          @update:model-value="updateDefinition({ args: $event.split('\n').filter(Boolean) })"
        />
      </SettingsRow>
      <SettingsRow v-if="!remote" title="环境变量" description="JSON 对象格式，不会出现在列表里" wide>
        <Field
          label="环境变量（JSON 格式）"
          multiline
          :rows="4"
          :model-value="envText"
          placeholder='{"API_KEY": "xxx"}'
          :error="envError"
          @update:model-value="tryUpdateEnv"
        />
      </SettingsRow>
    </SettingsList>

    <footer class="mcp-actions">
      <div class="mcp-actions__row">
        <Button :disabled="result?.state === 'running'" @click="emit('test')">
          <Icon name="play" :size="18" />{{ result?.state === 'running' ? '连接中…' : '测试连接' }}
        </Button>
        <Button variant="danger" @click="deleteOpen = true"><Icon name="trash" :size="18" />删除此服务</Button>
      </div>
      <p v-if="result" class="mcp-test" :class="`mcp-test--${result.state}`" role="status">{{ result.text }}</p>
    </footer>

    <Dialog :open="deleteOpen" label="删除 MCP 服务" @update:open="deleteOpen = $event">
      <p>这个 MCP 服务会从列表中移除。</p>
      <div class="dialog-actions">
        <Button @click="deleteOpen = false">取消</Button>
        <Button variant="danger" @click="deleteOpen = false; emit('delete')">删除</Button>
      </div>
    </Dialog>
  </form>
</template>>

<style scoped lang="scss" src="../../styles/components/capabilities/MCPEditor.scss"></style>
