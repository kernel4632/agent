<!--
高级设置：项目规则、写后诊断和 shell 改动快照。
表单控件统一用 ui/ 里的 Field、Switch；数字转换仍在本组件完成，事件只把结果交给上层写回草稿。
调用示例：<AdvancedSettings :draft="draft" />；只改隔离草稿，SettingsView 负责保存。
-->
<script setup>
import { computed } from 'vue'
import { Field, Switch } from '../ui/index.js'

const props = defineProps({ draft: { type: Object, required: true } })

// 规则默认开；配置里只有明确写 false 才关。
const rulesOn = computed(() => props.draft.rules.enabled !== false)

// 缺字段时给出和 README 一致的默认值，避免输入框显示 undefined。
const diagnostics = computed(() => ({ command: '', delay: 0, timeout: 30000, ...props.draft.diagnostics }))
const snapshot = computed(() => ({ shell: false, maxFiles: 2000, maxBytes: 2097152, ...props.draft.snapshot }))
const maxMb = computed(() => Math.max(1, Math.round((Number(snapshot.value.maxBytes) || 2097152) / 1048576)))

function setRules(value) {
  props.draft.rules = { ...props.draft.rules, enabled: value }
}

function setDiagnostics(change) {
  props.draft.diagnostics = { ...props.draft.diagnostics, ...change }
}

function setSnapshot(change) {
  props.draft.snapshot = { ...props.draft.snapshot, ...change }
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
  </section>
</template>

<style scoped lang="scss" src="../styles/components/AdvancedSettings.scss"></style>
