<!--
高级设置：项目规则、写后诊断、shell 改动快照和自定义模式。
表单控件统一用 ui/ 里的 Field、Switch、Button；数字转换和 JSON 校验仍在本组件完成，事件只把结果交给上层写回草稿。
调用示例：<AdvancedSettings :rules="draft.rules" :modes="draft.modeDefinitions" :diagnostics="draft.diagnostics" :snapshot="draft.snapshot" />
-->
<script setup>
import { computed, ref } from 'vue'
import Button from '../../ui/Button.vue'
import Field from '../../ui/Field.vue'
import Switch from '../../ui/Switch.vue'

const props = defineProps({
  rules: { type: Object, default: () => ({}) },
  modes: { type: Object, default: () => ({}) },
  diagnostics: { type: Object, default: () => ({}) },
  snapshot: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:rules', 'update:modes', 'update:diagnostics', 'update:snapshot'])

// 规则默认开；配置里只有明确写 false 才关。
const rulesOn = computed(() => props.rules.enabled !== false)

// 缺字段时给出和 README 一致的默认值，避免输入框显示 undefined。
const diagnostics = computed(() => ({ command: '', delay: 0, timeout: 30000, ...props.diagnostics }))
const snapshot = computed(() => ({ shell: false, maxFiles: 2000, maxBytes: 2097152, ...props.snapshot }))
const maxMb = computed(() => Math.max(1, Math.round((Number(snapshot.value.maxBytes) || 2097152) / 1048576)))

// 模式用 JSON 编辑：应用按钮解析成功后才写进草稿，写错不会破坏已有设置。
const modesText = ref(JSON.stringify(props.modes || {}, null, 2))
const modesError = ref('')

function setRules(value) {
  emit('update:rules', { ...props.rules, enabled: value })
}

function setDiagnostics(change) {
  emit('update:diagnostics', { ...props.diagnostics, ...change })
}

function setSnapshot(change) {
  emit('update:snapshot', { ...props.snapshot, ...change })
}

function applyModes() {
  try {
    const parsed = JSON.parse(modesText.value || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('必须是一个 JSON 对象')
    modesError.value = ''
    emit('update:modes', parsed)
  } catch (error) {
    modesError.value = `模式 JSON 有问题：${error.message}`
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
        <Switch :model-value="rulesOn" label="读取项目规则" @update:model-value="setRules" />
      </div>
    </div>

    <div class="advanced-settings__block">
      <h3>写后诊断</h3>
      <p>每次写完文件后跑一条命令，把错误附在工具结果后面交给模型。留空表示不跑。</p>
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
        <Switch :model-value="snapshot.shell === true" label="记录 shell 改动" @update:model-value="setSnapshot({ shell: $event })" />
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
      <h3>自定义模式</h3>
      <p>一个 JSON 对象，键是模式名，值是 <code>label</code>、<code>tools</code>、<code>readOnly</code>。改完点「应用模式」。</p>
      <Field
        v-model="modesText"
        class="advanced-settings__modes"
        multiline
        label="自定义模式 JSON"
        spellcheck="false"
      />
      <div class="advanced-settings__actions">
        <span v-if="modesError" class="advanced-settings__error">{{ modesError }}</span>
        <Button @click="applyModes">应用模式</Button>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.advanced-settings {
  display: grid;
  gap: 32px;
  color: var(--la-secondary);
  font-size: 13px;
}

.advanced-settings__block {
  display: grid;
  gap: 12px;
  padding: 20px;
  border: 0;
  border-radius: 8px;
  background: var(--la-layer-01);
  box-shadow: inset 0 0 0 .5px var(--la-line);
}

.advanced-settings__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

h3 {
  margin: 0;
  color: var(--la-text);
  font-size: 13px;
  font-weight: 530;
  line-height: 16px;
}

p {
  margin: 4px 0 0;
  color: var(--la-muted);
  line-height: 20px;
  font-size: 13px;
  font-weight: 440;
}

code {
  font-family: var(--la-font-mono);
  font-size: 12px;
}

.advanced-settings__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

/* 自定义模式沿用原来的等宽小字和 120px 高度。 */
.advanced-settings__modes :deep(.ui-field__input--multiline) {
  min-height: 120px;
  font-family: var(--la-font-mono);
  font-size: 11px;
  line-height: 1.6;
  resize: vertical;
}

.advanced-settings__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.advanced-settings__error {
  color: var(--la-danger);
  overflow-wrap: anywhere;
}

@media (max-width: 760px) {
  .advanced-settings__row { grid-template-columns: 1fr; }
}
</style>
