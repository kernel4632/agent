<!--
当前会话统计：把 RikkaHub 的助手统计页映射成现有会话数据。
数据来自已加载的会话消息；导出按钮读取服务端最新会话 JSON，作为备份入口。
调用示例：<SessionStatsDialog :open="statsOpen" :session="activeSession" @update:open="statsOpen = $event" />
-->
<script setup>
import { computed, ref } from 'vue'
import { AgentAPI } from '../api.js'
import { AppIcon, Button, Dialog } from '../ui/index.js'
import { UI } from '../commands/ui.js'

const props = defineProps({
  open: Boolean,
  session: { type: Object, default: null },
})
const emit = defineEmits(['update:open'])
const exporting = ref(false)

const stats = computed(() => {
  const messages = props.session?.messages || []
  let user = 0
  let assistant = 0
  let reasoning = 0
  let tools = 0
  let input = 0
  let output = 0
  for (const message of messages) {
    if (message.role === 'user') user += 1
    else {
      assistant += 1
      if (message.reasoning) reasoning += 1
      tools += message.tools?.length || 0
      input += Number(message.request?.input) || 0
      output += Number(message.request?.output) || 0
    }
  }
  return { user, assistant, reasoning, tools, input, output }
})

async function exportSession() {
  if (!props.session?.id || exporting.value) return
  exporting.value = true
  try {
    const data = await AgentAPI.getSession(props.session.id)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${(props.session.title || '会话').replace(/[\\/:*?"<>|]/g, '_')}.json`
    link.click()
    URL.revokeObjectURL(url)
    UI.notify('当前会话已导出')
  } catch {
    UI.notify('导出失败，请检查后端连接')
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <Dialog :open="open" label="会话统计" @update:open="emit('update:open', $event)">
    <div class="stats-dialog">
      <p>{{ session?.title || '新会话' }}</p>
      <div class="stats-grid">
        <div><strong>{{ stats.user }}</strong><span>你的消息</span></div>
        <div><strong>{{ stats.assistant }}</strong><span>助手回复</span></div>
        <div><strong>{{ stats.reasoning }}</strong><span>思考过程</span></div>
        <div><strong>{{ stats.tools }}</strong><span>工具调用</span></div>
        <div><strong>{{ stats.input.toLocaleString() }}</strong><span>输入 tokens</span></div>
        <div><strong>{{ stats.output.toLocaleString() }}</strong><span>输出 tokens</span></div>
      </div>
      <p class="stats-model">模型：{{ session?.model || '未选择' }}</p>
      <div class="dialog-actions">
        <Button type="button" :disabled="!session?.id || exporting" @click="exportSession"><AppIcon name="download" :size="15" />{{ exporting ? '导出中…' : '导出会话' }}</Button>
        <Button type="button" @click="emit('update:open', false)">关闭</Button>
      </div>
    </div>
  </Dialog>
</template>

<style scoped lang="scss">
.stats-dialog { width: 100%; min-width: 0; }
.stats-dialog > p { margin: 0 0 20px; color: var(--la-secondary); font-size: 14px; font-weight: 400; line-height: 22px; }
.stats-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.stats-grid > div { display: flex; min-width: 0; flex-direction: column; gap: 4px; padding: 16px; border-radius: 16px; background: var(--la-layer-02); }
.stats-grid strong { color: var(--la-text); font-size: 26px; font-weight: 600; line-height: 32px; }
.stats-grid span { color: var(--la-muted); font-size: 13px; line-height: 18px; }
.stats-model { margin-top: 16px !important; }
</style>
