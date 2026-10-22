<!--
  工具行内容：按工具脚本里的 ui.view 选择展示方式。
  行标题、图标和操作由 tool-ui.js 读取后端工具目录；这里只负责把调用参数和结果画出来。
  不改变对话的纯列表结构：所有内容仍然落在同一行的文本列里。
-->
<script setup>
import { computed } from 'vue'
import { AppIcon, Button } from '../../ui/index.js'
import { UI } from '../../commands/ui.js'
import {
    actionTarget,
    outputText,
    outputValue,
    toolActions,
    uiFor,
} from '../tool-ui.js'

const props = defineProps({
    tool: { type: Object, required: true },
})

const ui = computed(() => uiFor(props.tool.name))
const view = computed(() => ui.value.view || 'generic')
const input = computed(() => props.tool.input || {})
const value = computed(() => outputValue(props.tool))
const text = computed(() => outputText(props.tool))
const actions = computed(() => toolActions(props.tool))
const hasInput = computed(() => Object.keys(input.value).length > 0)

const command = computed(() => value.value && typeof value.value === 'object' && !Array.isArray(value.value) ? value.value : null)
const entries = computed(() => {
    if (Array.isArray(value.value)) return value.value.map(item => String(item))
    return text.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
})
const todoItems = computed(() => Array.isArray(value.value?.items) ? value.value.items : [])
const patchPaths = computed(() => (Array.isArray(input.value.patches) ? input.value.patches : [])
    .map(patch => patch?.path || patch?.file_path)
    .filter(Boolean))
const questionText = computed(() => text.value || input.value.question || input.value.result || '')

const clip = (value, limit = 2400) => {
    const content = String(value ?? '')
    return content.length > limit ? `${content.slice(0, limit)}\n…` : content
}

const statusIcon = status => status === 'completed' ? 'check' : status === 'in_progress' ? 'clock' : 'info'
const statusLabel = status => status === 'completed' ? '已完成' : status === 'in_progress' ? '进行中' : '待处理'

async function runAction(action) {
    // 工具只声明动作类型和目标字段；这里集中处理副作用。
    const value = actionTarget(props.tool, action)
    if (!value) return
    if (action.type === 'copy') await UI.copy(value)
    if (action.type === 'open') window.open(value, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <div class="tool-view">
    <template v-if="view === 'todo'">
      <div v-if="todoItems.length" class="todo-list">
        <div v-for="(item, index) in todoItems" :key="index" class="todo-item">
          <AppIcon :name="statusIcon(item.status)" :size="13" class="todo-item__icon" :class="`is-${item.status}`" />
          <span class="todo-item__text" :class="{ 'is-done': item.status === 'completed' }">{{ item.text }}</span>
          <span class="todo-item__status">{{ statusLabel(item.status) }}</span>
        </div>
      </div>
      <p v-else class="tool-empty">暂无任务项</p>
    </template>

    <template v-else-if="view === 'command'">
      <div v-if="input.command" class="tool-kicker"><code>{{ input.command }}</code></div>
      <template v-if="command">
        <pre v-if="command.stdout" class="tool-output">{{ command.stdout }}</pre>
        <pre v-if="command.stderr" class="tool-output is-error">{{ command.stderr }}</pre>
        <div class="tool-meta">
          <span>退出码 {{ command.exitCode ?? '-' }}</span>
          <span v-if="command.timedOut" class="is-error">已超时</span>
        </div>
      </template>
      <pre v-else-if="text" class="tool-output">{{ text }}</pre>
    </template>

    <template v-else-if="view === 'search'">
      <div class="tool-meta">
        <span>正则 <code>{{ input.regex || input.pattern }}</code></span>
        <span v-if="input.file_pattern || input.include">{{ input.file_pattern || input.include }}</span>
      </div>
      <pre v-if="text" class="tool-output">{{ text }}</pre>
      <p v-else class="tool-empty">没有匹配结果</p>
    </template>

    <template v-else-if="view === 'file-list'">
      <div class="tool-meta">
        <span>{{ input.path }}</span>
        <span v-if="input.recursive">递归</span>
      </div>
      <div v-if="entries.length" class="file-list">
        <span v-for="entry in entries" :key="entry" class="file-entry">{{ entry }}</span>
      </div>
      <p v-else class="tool-empty">目录为空</p>
    </template>

    <template v-else-if="view === 'edit'">
      <div class="edit-pair">
        <div>
          <small>替换前</small>
          <pre class="tool-output">{{ clip(input.old_string || input.oldText) }}</pre>
        </div>
        <div>
          <small>替换后</small>
          <pre class="tool-output">{{ clip(input.new_string || input.newText) }}</pre>
        </div>
      </div>
      <div v-if="text" class="tool-result">{{ text }}</div>
    </template>

    <template v-else-if="view === 'completion' || view === 'question'">
      <div class="tool-result" :class="{ 'is-question': view === 'question' }">{{ questionText }}</div>
    </template>

    <template v-else-if="view === 'web'">
      <a v-if="input.url" :href="input.url" target="_blank" rel="noreferrer" class="tool-link">{{ input.url }}</a>
      <pre v-if="text" class="tool-output">{{ text }}</pre>
    </template>

    <template v-else-if="view === 'subtask'">
      <div v-if="input.description" class="tool-kicker">{{ input.description }}</div>
      <pre v-if="input.prompt" class="tool-output">{{ input.prompt }}</pre>
    </template>

    <template v-else-if="view === 'patch'">
      <div v-if="patchPaths.length" class="file-list">
        <span v-for="path in patchPaths" :key="path" class="file-entry">{{ path }}</span>
      </div>
      <div v-if="text" class="tool-result">{{ text }}</div>
    </template>

    <template v-else-if="view === 'file-read' || view === 'file-write'">
      <pre v-if="text" class="tool-output" :class="{ 'is-error': tool.status === 'error' || tool.status === 'rejected' }">{{ text }}</pre>
      <p v-else class="tool-empty">暂无输出</p>
    </template>

    <template v-else>
      <pre v-if="hasInput" class="tool-output">{{ JSON.stringify(input, null, 2) }}</pre>
      <pre v-if="text" class="tool-output" :class="{ 'is-error': tool.status === 'error' || tool.status === 'rejected' }">{{ text }}</pre>
    </template>

    <div v-if="actions.length" class="tool-actions">
      <Button v-for="action in actions" :key="action.id" variant="ghost" size="small" @click="runAction(action)">
        <AppIcon v-if="action.icon" :name="action.icon" :size="13" />{{ action.label }}
      </Button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.tool-view { display: grid; gap: 8px; min-width: 0; }
.tool-kicker { min-width: 0; color: var(--la-secondary); font: 12px/1.7 var(--la-font-mono); overflow-wrap: anywhere; }
.tool-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; min-width: 0; color: var(--la-muted); font-size: 11.5px; line-height: 1.5; }
.tool-meta code { color: var(--la-secondary); font: 11.5px/1.5 var(--la-font-mono); overflow-wrap: anywhere; }
.tool-output {
  max-width: 100%;
  max-height: 240px;
  overflow: auto;
  margin: 0;
  padding: 4px 0 4px 8px;
  border: 0;
  border-left: 2px solid var(--la-line);
  background: transparent;
  color: var(--la-secondary);
  font: 12px/1.7 var(--la-font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.tool-output.is-error { color: var(--la-danger); border-left-color: var(--la-danger); }
.tool-result { color: var(--la-secondary); font-size: 12.5px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.tool-result.is-question { color: var(--la-text); }
.tool-empty { margin: 0; color: var(--la-muted); font-size: 12px; line-height: 1.6; }
.tool-link { color: var(--la-accent); font-size: 12px; overflow-wrap: anywhere; text-underline-offset: 3px; }
.tool-actions { display: flex; flex-wrap: wrap; gap: 4px; }
.tool-actions .ui-button { display: inline-flex; align-items: center; gap: 4px; padding: 0 6px; color: var(--la-muted); font-size: 11.5px; }
.tool-actions .ui-button:hover { color: var(--la-text); }

.todo-list { display: grid; gap: 3px; }
.todo-item { display: flex; align-items: baseline; gap: 6px; min-width: 0; color: var(--la-secondary); font-size: 12.5px; line-height: 1.6; }
.todo-item__icon { flex: 0 0 auto; color: var(--la-muted); }
.todo-item__icon.is-completed { color: var(--la-success); }
.todo-item__icon.is-in_progress { color: var(--la-accent); }
.todo-item__text { min-width: 0; overflow-wrap: anywhere; }
.todo-item__text.is-done { color: var(--la-muted); text-decoration: line-through; }
.todo-item__status { margin-left: auto; flex: 0 0 auto; color: var(--la-muted); font-size: 11px; }

.file-list { display: flex; flex-wrap: wrap; gap: 3px 8px; }
.file-entry { color: var(--la-secondary); font: 12px/1.7 var(--la-font-mono); overflow-wrap: anywhere; }
.file-entry + .file-entry::before { color: var(--la-muted); content: '·'; margin-right: 8px; }
.edit-pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
.edit-pair small { display: block; margin-bottom: 2px; color: var(--la-muted); font-size: 11px; }
.edit-pair .tool-output { max-height: 160px; }
@media (max-width: 767px) {
  .edit-pair { grid-template-columns: minmax(0, 1fr); }
}
</style>
