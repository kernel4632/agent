<!--
高级设置：项目规则、写后诊断、shell 改动快照和智能体定义。
表单控件统一用 ui/ 里的 Field、Switch、Button；数字转换和 JSON 校验仍在本组件完成，事件只把结果交给上层写回草稿。
调用示例：<AdvancedSettings :rules="draft.rules" :agents="draft.agentDefinitions" :diagnostics="draft.diagnostics" :snapshot="draft.snapshot" />
-->
<script setup>
import { computed, ref } from 'vue'
import { Button, Field, Switch } from '../../ui/index.js'

const props = defineProps({
  rules: { type: Object, default: () => ({}) },
  agents: { type: Object, default: () => ({}) },
  diagnostics: { type: Object, default: () => ({}) },
  snapshot: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:rules', 'update:agents', 'update:diagnostics', 'update:snapshot'])

// 规则默认开；配置里只有明确写 false 才关。
const rulesOn = computed(() => props.rules.enabled !== false)

// 缺字段时给出和 README 一致的默认值，避免输入框显示 undefined。
const diagnostics = computed(() => ({ command: '', delay: 0, timeout: 30000, ...props.diagnostics }))
const snapshot = computed(() => ({ shell: false, maxFiles: 2000, maxBytes: 2097152, ...props.snapshot }))
const maxMb = computed(() => Math.max(1, Math.round((Number(snapshot.value.maxBytes) || 2097152) / 1048576)))

// 智能体用 JSON 编辑：应用按钮解析成功后才写进草稿，写错不会破坏已有设置。
const agentsText = ref(JSON.stringify(props.agents || {}, null, 2))
const agentsError = ref('')

function setRules(value) {
  emit('update:rules', { ...props.rules, enabled: value })
}

function setDiagnostics(change) {
  emit('update:diagnostics', { ...props.diagnostics, ...change })
}

function setSnapshot(change) {
  emit('update:snapshot', { ...props.snapshot, ...change })
}

function applyAgents() {
  try {
    const parsed = JSON.parse(agentsText.value || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('必须是一个 JSON 对象')
    agentsError.value = ''
    emit('update:agents', parsed)
  } catch (error) {
    agentsError.value = `智能体 JSON 有问题：${error.message}`
  }
}
</script>

<template>
  <section class="advanced-settings">
    <div class="advanced-settings__block">
      <div class="advanced-settings__head">
        <div>
          <h3>项目规则</h3>
          <p>自动读取 AGENTS.md、<code>.agent/rules</code> 和 <code>.roo/rules</code>，拼进系统提示词。</p>
        </div>
        <Switch hide-label :model-value="rulesOn" label="读取项目规则" @update:model-value="setRules" />
      </div>
    </div>

    <div class="advanced-settings__block">
      <div class="advanced-settings__intro">
        <h3>写后诊断</h3>
        <p>每次写完文件后跑一条命令，把错误附在工具结果后面交给模型。留空表示不跑。</p>
      </div>
      <Field
        caption="命令"
        :model-value="diagnostics.command"
        placeholder="例如：bun run typecheck"
        @update:model-value="setDiagnostics({ command: $event })"
      />
      <div class="advanced-settings__row">
        <Field
          caption="等待（毫秒）"
          type="number"
          min="0"
          max="10000"
          :model-value="diagnostics.delay"
          @update:model-value="setDiagnostics({ delay: Number($event) || 0 })"
        />
        <Field
          caption="超时（毫秒）"
          type="number"
          min="1000"
          max="120000"
          :model-value="diagnostics.timeout"
          @update:model-value="setDiagnostics({ timeout: Number($event) || 30000 })"
        />
      </div>
    </div>

    <div class="advanced-settings__block">
      <div class="advanced-settings__head">
        <div>
          <h3>shell 改动快照</h3>
          <p>执行命令前扫一遍工作区，命令改过的文件也能回退。文件多时命令会变慢。</p>
        </div>
        <Switch hide-label :model-value="snapshot.shell === true" label="记录 shell 改动" @update:model-value="setSnapshot({ shell: $event })" />
      </div>
      <div class="advanced-settings__row">
        <Field
          caption="最多文件数"
          type="number"
          min="1"
          :model-value="snapshot.maxFiles"
          @update:model-value="setSnapshot({ maxFiles: Number($event) || 2000 })"
        />
        <Field
          caption="单文件上限（MB）"
          type="number"
          min="1"
          :model-value="maxMb"
          @update:model-value="setSnapshot({ maxBytes: (Number($event) || 2) * 1048576 })"
        />
      </div>
    </div>

    <div class="advanced-settings__block">
      <div class="advanced-settings__intro">
        <h3>智能体定义</h3>
        <p>一个 JSON 对象，键是智能体名，值是 <code>label</code>、<code>description</code>、<code>instructions</code>、<code>tools</code>、<code>readOnly</code>、<code>model</code>、<code>permission</code>。改完点「应用智能体」。</p>
      </div>
      <Field
        v-model="agentsText"
        multiline
        :rows="8"
        label="智能体 JSON"
        spellcheck="false"
      />
      <div class="advanced-settings__actions">
        <span v-if="agentsError" class="advanced-settings__error">{{ agentsError }}</span>
        <Button variant="primary" @click="applyAgents">应用智能体</Button>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.advanced-settings {
  display: grid;
  min-width: 0;
  gap: 24px;
  color: var(--la-secondary);
  font-size: 14px;
}

.advanced-settings__block {
  display: grid;
  min-width: 0;
  gap: 20px;
  padding: 24px;
  border: 0;
  border-radius: 20px;
  background: var(--la-layer-01);
}
/* 多行输入自带较宽的默认列宽，不能让 320px 下的卡片被它撑出屏幕。 */
.advanced-settings__block > * { min-width: 0; max-width: 100%; }

.advanced-settings__head {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}
.advanced-settings__head > div { min-width: 0; }

.advanced-settings__intro { display: grid; gap: 4px; }
.advanced-settings__intro p { margin: 0; }

h3 {
  margin: 0;
  color: var(--la-text);
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}

p {
  margin: 4px 0 0;
  color: var(--la-muted);
  line-height: 22px;
  font-size: 14px;
  font-weight: 400;
}

code {
  font-family: var(--la-font-mono);
  font-size: 13px;
}

.advanced-settings__row {
  display: grid;
  min-width: 0;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.advanced-settings__row > * { min-width: 0; }

.advanced-settings__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
}

.advanced-settings__error {
  color: var(--la-danger);
  overflow-wrap: anywhere;
}

@media (max-width: 760px) {
  .advanced-settings__block { padding: 20px; }
  .advanced-settings__row { grid-template-columns: 1fr; }
}
</style>
