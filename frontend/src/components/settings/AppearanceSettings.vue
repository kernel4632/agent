<!--
语言与外观设置：配置界面语言、信息密度和动画偏好。
设计思想：外观偏好只在前端持久化（localStorage），不发送到 Server。
核心数据：appearance（包含 language、density、animations 字段）。
调用示例：<AppearanceSettings v-model:appearance="settingsDraft.appearance" />。
-->
<script setup>
const props = defineProps({
  appearance: { type: Object, required: true },             // 接收外观设置对象（双向绑定）
})
const emit = defineEmits(['update:appearance'])              // 输出变更后的外观对象


// --- 修改单个外观字段 ---
function updateField(field, value) {
  emit('update:appearance', { ...props.appearance, [field]: value }) // 只替换目标字段
}
</script>

<template>
  <section class="appearance-settings">
    <!-- 顶部标题栏。 -->
    <header class="appearance-settings__header">
      <div>
        <m3e-heading variant="headline" size="small" level="2">语言与外观</m3e-heading>
        <span>保持黑白工作台的阅读密度与反馈节奏</span>
      </div>
    </header>

    <!-- 设置选项列表。 -->
    <div class="appearance-settings__body">
      <div class="appearance-settings__options">

        <!-- 界面语言。 -->
        <div class="appearance-settings__option">
          <div class="appearance-settings__label">
            <strong>界面语言</strong>
            <span>控制按钮、标签和提示文案的显示语言</span>
          </div>
          <m3e-select
            class="appearance-settings__select"
            :value="props.appearance.language || 'zh-CN'"
            @change="updateField('language', $event.currentTarget.value)"
          >
            <m3e-option value="zh-CN">简体中文</m3e-option>
            <m3e-option value="en-US">English</m3e-option>
          </m3e-select>
        </div>

        <!-- 界面密度。 -->
        <div class="appearance-settings__option">
          <div class="appearance-settings__label">
            <strong>界面密度</strong>
            <span>调整列表和卡片的间距与内边距</span>
          </div>
          <m3e-select
            class="appearance-settings__select"
            :value="props.appearance.density || 'comfortable'"
            @change="updateField('density', $event.currentTarget.value)"
          >
            <m3e-option value="comfortable">舒适</m3e-option>
            <m3e-option value="compact">紧凑</m3e-option>
          </m3e-select>
        </div>

        <!-- 界面动画。 -->
        <div class="appearance-settings__option">
          <div class="appearance-settings__label">
            <strong>界面动画</strong>
            <span>保留侧栏、弹窗和状态过渡动画</span>
          </div>
          <m3e-switch
            :checked="props.appearance.animations !== false"
            @change="updateField('animations', $event.currentTarget.checked)"
          ></m3e-switch>
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
  border-bottom: 1px solid #242424;
}

.appearance-settings__header > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.appearance-settings__header span { color: #7f7f7f; font-size: 13px; }

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
  border: 1px solid #303030;
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
  color: #e0e0e0;
  font-size: 14px;
}

.appearance-settings__label span {
  color: #858585;
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
