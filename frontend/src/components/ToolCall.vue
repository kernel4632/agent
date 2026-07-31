<!--
工具调用组件：把 Agent 的工具动作翻译成人可以快速确认的操作卡片。
触发事件由审批按钮或回滚动作产生，父级继续负责 Server 指令和状态同步。
调用示例：<ToolCall :tool-call="item" :step="3" @rollback="rollback" />。
-->
<script setup>
import { computed } from 'vue'                         // 引入工具摘要和参数条目的派生能力

const props = defineProps({                           // 声明工具卡片需要的业务数据
  toolCall: { type: Object, required: true },          // 工具名、输入、输出和运行状态
  step: { type: Number, default: 0 },                 // 已持久化工具步骤，用于回滚
})

const emit = defineEmits(['rollback', 'approval'])     // 将用户决定交回对话业务视图
const statusLabels = { waiting: '需要确认', deciding: '正在提交', rejected: '已拒绝', running: '执行中', completed: '已完成' } // 统一状态文案
const fieldLabels = { path: '文件', command: '命令', cwd: '目录', query: '查询', pattern: '匹配', url: '地址', content: '内容', summary: '摘要', tasks: '任务' } // 常见工具参数的人类化名称
const toolMeta = {                                    // 根据工具动作提供稳定的视觉身份
  read_file: { label: '读取文件', icon: 'file' },
  write_file: { label: '写入文件', icon: 'edit' },
  list_files: { label: '查看目录', icon: 'folder' },
  search_files: { label: '搜索文件', icon: 'search' },
  run_command: { label: '执行命令', icon: 'terminal' },
  web_fetch: { label: '读取网页', icon: 'globe' },
  search_web: { label: '搜索网页', icon: 'globe' },
  task_list_update: { label: '更新任务计划', icon: 'plan' },
  task_done: { label: '完成任务', icon: 'check' },
}

const meta = computed(() => toolMeta[props.toolCall.name] || { label: '工具调用', icon: 'tool' }) // 未知工具仍保持可读身份
const status = computed(() => statusLabels[props.toolCall.status] || (props.toolCall.output !== null && props.toolCall.output !== undefined ? '已完成' : '执行中')) // 从状态或结果推导反馈
const input = computed(() => props.toolCall.input && typeof props.toolCall.input === 'object' ? props.toolCall.input : {}) // 保持参数遍历安全
const entries = computed(() => Object.entries(input.value).filter(([name]) => name !== 'tasks' && input.value[name] !== undefined && input.value[name] !== null && input.value[name] !== '')) // 将普通参数转为信息条
const tasks = computed(() => Array.isArray(input.value.tasks) ? input.value.tasks : []) // 任务工具单独渲染清单而不是 JSON
const result = computed(() => props.toolCall.output) // 保留真实结果供摘要和展开详情使用
const primaryValue = computed(() => input.value.command || input.value.path || input.value.url || input.value.query || input.value.pattern || input.value.summary || (tasks.value.length ? `${tasks.value.length} 项任务` : '')) // 把最重要参数放进折叠行
const expanded = computed(() => ['waiting', 'deciding'].includes(props.toolCall.status)) // 需要用户处理时自动展开


// --- 格式化参数信息 ---
function formatValue(value) {
  if (typeof value === 'string') return value              // 文本参数直接展示
  if (Array.isArray(value)) return `${value.length} 项`    // 数组先展示数量，避免卡片被撑高
  return String(value)                                     // 数字和布尔值使用短文本
}


// --- 生成工具结果摘要 ---
function resultSummary(value) {
  if (value === null || value === undefined) return ''     // 尚未结束时不显示空结果区
  if (value?.denied) return value.result || '用户拒绝了这次工具调用' // 拒绝结果优先反馈原因
  if (props.toolCall.name === 'task_list_update') return `已更新 ${Array.isArray(value.tasks) ? value.tasks.length : tasks.value.length} 项任务` // 计划更新显示业务结果
  if (props.toolCall.name === 'task_done') return value.result || 'Agent 已完成当前任务' // 完成工具使用直接摘要
  if (typeof value === 'string') return value.split('\n')[0] || '已返回结果' // 普通文本只取首行作为卡片摘要
  if (value.result && typeof value.result === 'string') return value.result.split('\n')[0] || '已返回结果' // 兼容工具包装结果
  return '已返回结构化结果'                             // 其余对象保留展开查看入口
}


// --- 提交一个审批决定 ---
function decide(decision) {
  emit('approval', { toolCallID: props.toolCall.id, decision }) // 只向父级发送身份和决定
}
</script>

<template>
  <article class="tool-call" :class="[`tool-call--${meta.icon}`, `is-${props.toolCall.status || 'completed'}`]">
    <mdui-collapse class="tool-call__collapse">
      <mdui-collapse-item :active="expanded">
        <div slot="header" class="tool-call__header">
          <span class="tool-call__icon" aria-hidden="true">{{ meta.icon === 'terminal' ? '>_' : meta.icon === 'plan' ? '☷' : meta.icon === 'check' ? '✓' : '◇' }}</span>
          <strong>{{ meta.label }}</strong>
          <code v-if="primaryValue" class="tool-call__summary">{{ primaryValue }}</code>
          <span class="tool-call__status"><i></i>{{ status }}</span>
          <button v-if="step" class="tool-call__rollback" type="button" @click.stop="emit('rollback', step)">回滚</button>
          <mdui-icon-expand-more class="tool-call__chevron"></mdui-icon-expand-more>
        </div>

        <div class="tool-call__body">
          <div v-if="entries.length" class="tool-call__fields">
            <div v-for="([name, value]) in entries" :key="name" class="tool-call__field">
              <span>{{ fieldLabels[name] || name }}</span>
              <code>{{ formatValue(value) }}</code>
            </div>
          </div>
          <ol v-if="tasks.length" class="tool-call__tasks">
            <li v-for="(task, index) in tasks" :key="`${task.content}-${index}`">
              <mdui-checkbox :checked="task.status === 'completed'" :indeterminate="task.status === 'in_progress'" tabindex="-1" @click.prevent></mdui-checkbox>
              <span>{{ task.content }}</span>
            </li>
          </ol>
          <div v-if="result !== null && result !== undefined" class="tool-call__result-row">
            <span>{{ resultSummary(result) }}</span>
          </div>
          <details v-if="Object.keys(input).length || (result !== null && result !== undefined)" class="tool-call__details">
            <summary>原始详情</summary>
            <div class="tool-call__details-grid">
              <div v-if="Object.keys(input).length"><small>输入</small><pre>{{ JSON.stringify(input, null, 2) }}</pre></div>
              <div v-if="result !== null && result !== undefined"><small>输出</small><pre>{{ JSON.stringify(result, null, 2) }}</pre></div>
            </div>
          </details>
        </div>
      </mdui-collapse-item>
    </mdui-collapse>

    <footer v-if="['waiting', 'deciding'].includes(props.toolCall.status)" class="tool-call__approval">
      <div class="tool-call__permission">
        <span v-if="props.toolCall.target"><small>目标</small><code>{{ props.toolCall.target }}</code></span>
        <span v-if="props.toolCall.matchedRule"><small>规则</small><code>{{ props.toolCall.matchedRule }}</code></span>
        <span v-if="!props.toolCall.target && !props.toolCall.matchedRule"><small>范围</small><code>{{ props.toolCall.scope || 'default' }}</code></span>
      </div>
      <div v-if="props.toolCall.approvalError" class="notice notice--error">{{ props.toolCall.approvalError }}</div>
      <div class="tool-call__approval-actions">
        <mdui-button variant="text" :disabled="props.toolCall.status === 'deciding'" @click="decide('deny')">拒绝</mdui-button>
        <mdui-button variant="tonal" :disabled="props.toolCall.status === 'deciding'" @click="decide('allow-once')">仅本次允许</mdui-button>
        <mdui-button variant="filled" :disabled="props.toolCall.status === 'deciding'" @click="decide('always-allow')">始终允许</mdui-button>
      </div>
    </footer>
  </article>
</template>
