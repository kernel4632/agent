<script setup>
import { computed, ref } from 'vue'

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
        <m3e-switch role="switch" :aria-checked="rulesOn" :checked="rulesOn" aria-label="读取项目规则" @change="setRules(!rulesOn)"></m3e-switch>
      </div>
    </div>

    <div class="advanced-settings__block">
      <h3>写后诊断</h3>
      <p>每次写完文件后跑一条命令，把错误附在工具结果后面交给模型。留空表示不跑。</p>
      <label>命令<input class="field" :value="diagnostics.command" placeholder="例如：bun run typecheck" @input="setDiagnostics({ command: $event.target.value })" /></label>
      <div class="advanced-settings__row">
        <label>等待（毫秒）<input class="field" type="number" min="0" max="10000" :value="diagnostics.delay" @input="setDiagnostics({ delay: Number($event.target.value) || 0 })" /></label>
        <label>超时（毫秒）<input class="field" type="number" min="1000" max="120000" :value="diagnostics.timeout" @input="setDiagnostics({ timeout: Number($event.target.value) || 30000 })" /></label>
      </div>
    </div>

    <div class="advanced-settings__block">
      <div class="advanced-settings__head">
        <div>
          <h3>shell 改动快照</h3>
          <p>执行命令前扫一遍工作区，命令改过的文件也能回退。文件多时命令会变慢。</p>
        </div>
        <m3e-switch role="switch" :aria-checked="snapshot.shell === true" :checked="snapshot.shell === true" aria-label="记录 shell 改动" @change="setSnapshot({ shell: !(snapshot.shell === true) })"></m3e-switch>
      </div>
      <div class="advanced-settings__row">
        <label>最多文件数<input class="field" type="number" min="1" :value="snapshot.maxFiles" @input="setSnapshot({ maxFiles: Number($event.target.value) || 2000 })" /></label>
        <label>单文件上限（MB）<input class="field" type="number" min="1" :value="maxMb" @input="setSnapshot({ maxBytes: (Number($event.target.value) || 2) * 1048576 })" /></label>
      </div>
    </div>

    <div class="advanced-settings__block">
      <h3>自定义模式</h3>
      <p>一个 JSON 对象，键是模式名，值是 <code>label</code>、<code>tools</code>、<code>readOnly</code>。改完点「应用模式」。</p>
      <textarea v-model="modesText" class="field advanced-settings__modes" spellcheck="false" aria-label="自定义模式 JSON"></textarea>
      <div class="advanced-settings__actions">
        <span v-if="modesError" class="advanced-settings__error">{{ modesError }}</span>
        <button class="button" type="button" @click="applyModes">应用模式</button>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.advanced-settings {
  display: grid;
  gap: 14px;
  color: var(--la-secondary);
  font-size: 12px;
}

.advanced-settings__block {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--la-line);
  border-radius: var(--la-radius);
  background: var(--la-setting-row);
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
  font-weight: 600;
}

p {
  margin: 4px 0 0;
  color: var(--la-muted);
  line-height: 1.6;
}

code {
  font-family: var(--la-font-mono);
  font-size: 11px;
}

label {
  display: grid;
  gap: 6px;
}

.advanced-settings__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.advanced-settings__modes {
  min-height: 170px;
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
  color: #fca5a5;
  overflow-wrap: anywhere;
}

@media (max-width: 760px) {
  .advanced-settings__row { grid-template-columns: 1fr; }
}
</style>
