<!--
语言与外观设置：配置界面语言、信息密度和动画偏好。
设计思想：外观偏好只在前端持久化（localStorage），不发送到 Server。
核心数据：appearance（包含 language、theme 字段）。
调用示例：<AppearanceSettings v-model:appearance="settingsDraft.appearance" />。
-->
<script setup>
import { t } from '../../i18n.js'

const props = defineProps({
  appearance: { type: Object, required: true },             // 接收外观设置对象（双向绑定）
})
const emit = defineEmits(['change'])
// --- 修改单个外观字段 ---
function updateField(field, value) {
  emit('change', { field, value })                          // 由草稿持有者执行写入，避免修改只读 props
}

</script>

<template>
  <section class="appearance-settings">
    <!-- 顶部标题栏。 -->
    <header class="appearance-settings__header">
      <div>
        <m3e-heading variant="headline" size="small" level="2">语言与外观</m3e-heading>
        <span>{{ t('appearanceDescription') }}</span>
      </div>
    </header>

    <!-- 设置选项列表。 -->
    <div class="appearance-settings__body">
      <div class="appearance-settings__options">

        <!-- 主题模式。 -->
        <div class="appearance-settings__option">
          <div class="appearance-settings__label">
            <strong>主题模式</strong>
            <span>亮色、暗色或跟随系统</span>
          </div>
          <m3e-form-field class="appearance-settings__select" variant="outlined" hide-subscript="always">
            <m3e-select @input="updateField('theme', $event.currentTarget.value)">
            <m3e-option value="system" :selected="(props.appearance.theme || 'system') === 'system'">跟随系统</m3e-option>
            <m3e-option value="light" :selected="props.appearance.theme === 'light'">亮色</m3e-option>
            <m3e-option value="dark" :selected="props.appearance.theme === 'dark'">暗色</m3e-option>
            </m3e-select>
          </m3e-form-field>
        </div>

      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
/* --- 外观设置主容器 --- */
.appearance-settings {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

/* --- 顶部标题栏 --- */
.appearance-settings__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  gap: 20px;
  padding: 26px 32px 22px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.appearance-settings__header > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.appearance-settings__header span { color: var(--md-sys-color-outline); font-size: 13px; }

/* --- 选项列表区域 --- */
.appearance-settings__body {
  overflow-y: auto;
  flex: 1 1 auto;
  padding: 24px 32px 48px;
  @include scrollbar-dark;
}

.appearance-settings__options {
  display: flex;
  width: min(640px, 100%);
  margin: 0 auto;
  flex-direction: column;
  gap: 8px;
}

/* --- 单行选项 --- */
.appearance-settings__option {
  display: flex;
  align-items: center;
  min-height: 64px;
  gap: 24px;
  padding: 16px 20px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 8px;
}

/* --- 选项标签区 --- */
.appearance-settings__label {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
}

.appearance-settings__label strong {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 14px;
}

.appearance-settings__label span {
  color: var(--md-sys-color-outline);
  font-size: 13px;
}

/* --- 选择器固定宽度 --- */
.appearance-settings__select {
  width: 160px;
  flex: 0 0 auto;
}

/* --- 移动端适配 --- */
@media (max-width: 760px) {
  .appearance-settings__body { padding: 20px 16px 40px; }
  .appearance-settings__option { flex-direction: column; align-items: flex-start; gap: 12px; }
  .appearance-settings__select { width: 100%; }
}
</style>
