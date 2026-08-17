<!--
系统提示词编辑：提供大文本区域编辑 Agent 的系统提示词。
设计思想：单一文本域，修改即时写入草稿，保存由设置页统一触发。
核心数据：prompt（系统提示词字符串）。
调用示例：<PromptsSettings v-model:prompt="settingsDraft.prompt" />。
-->
<script setup>
import { computed } from 'vue'                              // 引入计算属性

const props = defineProps({
  prompt: { type: String, required: true },                 // 接收系统提示词（双向绑定）
})
const emit = defineEmits(['update:prompt'])                  // 输出变更后的提示词

// --- 字符计数展示 ---
const charCount = computed(() => props.prompt.length)        // 实时统计提示词长度


// --- 输入变化时上抛 ---
function onInput(event) {
  emit('update:prompt', event.currentTarget.value)          // 每次输入立即同步到草稿
}
</script>

<template>
  <div class="prompts-settings">
    <span class="prompts-settings__count">{{ charCount }} 字符</span>
    <m3e-form-field class="prompts-settings__editor" variant="outlined" hide-subscript="always">
      <textarea
        class="prompts-settings__textarea"
        :value="props.prompt"
        placeholder="输入系统提示词...&#10;&#10;例如：你是一个专业的软件开发助手，擅长 TypeScript 和 Vue.js。&#10;回答时使用中文，保持简洁准确。"
        spellcheck="false"
        @input="onInput"
      ></textarea>
    </m3e-form-field>

    <!-- 使用提示。 -->
    <m3e-card class="prompts-settings__tips" variant="outlined">
      <m3e-heading slot="content" variant="title" size="small" level="3">提示词建议</m3e-heading>
      <ul slot="content">
        <li>明确 Agent 的身份和专长领域</li>
        <li>指定回复的语言和风格偏好</li>
        <li>列出需要遵守的规则和约束</li>
        <li>提供常用的项目上下文信息</li>
      </ul>
    </m3e-card>
  </div>
</template>

<style scoped lang="scss">
.prompts-settings {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px 32px 48px;
  @include scrollbar-dark;
}

.prompts-settings__count { color: var(--md-sys-color-outline); font-size: 13px; font-variant-numeric: tabular-nums; text-align: right; }

.prompts-settings__editor {
  width: min(820px, 100%);
  margin: 0 auto;
}

/* --- 文本输入框 --- */
.prompts-settings__textarea {
  width: 100%;
  min-height: 320px;
  padding: 16px 20px;
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.7;
  resize: vertical;
  outline: none;

  &::placeholder { color: var(--md-sys-color-outline); }
}

/* --- 使用提示 --- */
.prompts-settings__tips {
  width: min(820px, 100%);
  margin: 0 auto;
}

.prompts-settings__tips m3e-heading {
  display: block;
  padding: 16px 20px 0;
}

.prompts-settings__tips ul {
  margin: 0;
  padding: 10px 20px 16px 40px;
  color: var(--md-sys-color-outline);
  font-size: 13px;
  line-height: 2;
}

/* --- 移动端适配 --- */
@media (max-width: 760px) {
  .prompts-settings { padding: 20px 16px 40px; }
}
</style>
