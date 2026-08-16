<!--
外观设置：配置 M3E 动态颜色、对比度、密度、动效和焦点指示器。
设计思想：外观偏好只在前端持久化（localStorage），不发送到 Server。
核心数据：appearance（对应 ThemeElement 的全部公开主题属性）。
调用示例：<AppearanceSettings v-model:appearance="settingsDraft.appearance" />。
-->
<script setup>
import { t } from '../../i18n.js'
import { DEFAULT_APPEARANCE } from '../../theme.js'

const props = defineProps({
  appearance: { type: Object, required: true },             // 接收外观设置对象（双向绑定）
})
const emit = defineEmits(['change'])
// --- 修改单个外观字段 ---
function updateField(field, value) {
  emit('change', { field, value })                          // 由草稿持有者执行写入，避免修改只读 props
}

function resetAppearance() {
  for (const [field, value] of Object.entries(DEFAULT_APPEARANCE)) updateField(field, value)
}

</script>

<template>
  <section class="appearance-settings">
    <!-- 顶部标题栏。 -->
    <header class="appearance-settings__header">
      <div>
        <m3e-heading variant="headline" size="small" level="2">外观</m3e-heading>
        <span>{{ t('appearanceDescription') }}</span>
      </div>
    </header>

    <!-- 设置选项列表。 -->
    <m3e-content-pane class="appearance-settings__body">
      <div class="appearance-settings__toolbar">
        <m3e-button type="button" variant="text" @click="resetAppearance">恢复默认</m3e-button>
      </div>
      <m3e-list class="appearance-settings__options">

        <m3e-heading class="appearance-settings__group" variant="label" size="large" level="3">颜色</m3e-heading>
        <m3e-list-item class="appearance-settings__option">
          主题模式
          <span slot="supporting-text">亮色、暗色或跟随系统</span>
          <m3e-form-field slot="trailing" class="appearance-settings__select" variant="outlined" hide-subscript="always">
            <m3e-select @input="updateField('theme', $event.currentTarget.value)">
              <m3e-option value="system" :selected="(props.appearance.theme || 'system') === 'system'">跟随系统</m3e-option>
              <m3e-option value="light" :selected="props.appearance.theme === 'light'">亮色</m3e-option>
              <m3e-option value="dark" :selected="props.appearance.theme === 'dark'">暗色</m3e-option>
            </m3e-select>
          </m3e-form-field>
        </m3e-list-item>
        <m3e-divider></m3e-divider>

        <m3e-list-item class="appearance-settings__option">
          主题颜色
          <span slot="supporting-text">用于生成完整 Material You 动态色板</span>
          <label slot="trailing" class="appearance-settings__color-control">
            <span class="appearance-settings__color-value">{{ props.appearance.color || DEFAULT_APPEARANCE.color }}</span>
            <input
              type="color"
              :value="props.appearance.color || DEFAULT_APPEARANCE.color"
              aria-label="主题颜色"
              @input="updateField('color', $event.currentTarget.value)"
            >
          </label>
        </m3e-list-item>
        <m3e-divider></m3e-divider>

        <m3e-list-item class="appearance-settings__option">
          色板风格
          <span slot="supporting-text">选择动态颜色的生成算法</span>
          <m3e-form-field slot="trailing" class="appearance-settings__select" variant="outlined" hide-subscript="always">
            <m3e-select @input="updateField('variant', $event.currentTarget.value)">
              <m3e-option value="monochrome" :selected="props.appearance.variant === 'monochrome'">单色</m3e-option>
              <m3e-option value="neutral" :selected="props.appearance.variant === 'neutral'">中性</m3e-option>
              <m3e-option value="tonal-spot" :selected="(props.appearance.variant || DEFAULT_APPEARANCE.variant) === 'tonal-spot'">色调聚焦</m3e-option>
              <m3e-option value="vibrant" :selected="props.appearance.variant === 'vibrant'">鲜明</m3e-option>
              <m3e-option value="expressive" :selected="props.appearance.variant === 'expressive'">表现力</m3e-option>
              <m3e-option value="fidelity" :selected="props.appearance.variant === 'fidelity'">忠实原色</m3e-option>
              <m3e-option value="content" :selected="props.appearance.variant === 'content'">内容导向</m3e-option>
              <m3e-option value="rainbow" :selected="props.appearance.variant === 'rainbow'">彩虹</m3e-option>
              <m3e-option value="fruit-salad" :selected="props.appearance.variant === 'fruit-salad'">缤纷</m3e-option>
            </m3e-select>
          </m3e-form-field>
        </m3e-list-item>
        <m3e-divider></m3e-divider>

        <m3e-list-item class="appearance-settings__option">
          对比度
          <span slot="supporting-text">调整文字、边界与容器的可辨识程度</span>
          <m3e-form-field slot="trailing" class="appearance-settings__select" variant="outlined" hide-subscript="always">
            <m3e-select @input="updateField('contrast', $event.currentTarget.value)">
              <m3e-option value="standard" :selected="(props.appearance.contrast || DEFAULT_APPEARANCE.contrast) === 'standard'">标准</m3e-option>
              <m3e-option value="medium" :selected="props.appearance.contrast === 'medium'">中等</m3e-option>
              <m3e-option value="high" :selected="props.appearance.contrast === 'high'">高</m3e-option>
            </m3e-select>
          </m3e-form-field>
        </m3e-list-item>

        <m3e-heading class="appearance-settings__group" variant="label" size="large" level="3">界面</m3e-heading>
        <m3e-list-item class="appearance-settings__option">
          界面密度
          <span slot="supporting-text">控制组件尺寸和信息紧凑程度</span>
          <m3e-form-field slot="trailing" class="appearance-settings__select" variant="outlined" hide-subscript="always">
            <m3e-select @input="updateField('density', Number($event.currentTarget.value))">
              <m3e-option value="0" :selected="Number(props.appearance.density ?? DEFAULT_APPEARANCE.density) === 0">舒适</m3e-option>
              <m3e-option value="-1" :selected="Number(props.appearance.density) === -1">紧凑</m3e-option>
              <m3e-option value="-2" :selected="Number(props.appearance.density) === -2">高密度</m3e-option>
            </m3e-select>
          </m3e-form-field>
        </m3e-list-item>
        <m3e-divider></m3e-divider>

        <m3e-list-item class="appearance-settings__option">
          动效风格
          <span slot="supporting-text">标准缓动或 Material 3 Expressive 弹性动效</span>
          <m3e-form-field slot="trailing" class="appearance-settings__select" variant="outlined" hide-subscript="always">
            <m3e-select @input="updateField('motion', $event.currentTarget.value)">
              <m3e-option value="standard" :selected="props.appearance.motion === 'standard'">标准</m3e-option>
              <m3e-option value="expressive" :selected="(props.appearance.motion || DEFAULT_APPEARANCE.motion) === 'expressive'">表现力</m3e-option>
            </m3e-select>
          </m3e-form-field>
        </m3e-list-item>
        <m3e-divider></m3e-divider>

        <m3e-list-item class="appearance-settings__option">
          增强焦点指示器
          <span slot="supporting-text">为键盘导航显示更醒目的焦点轮廓</span>
          <m3e-switch
            slot="trailing"
            :checked="Boolean(props.appearance.strongFocus)"
            aria-label="增强焦点指示器"
            @change="updateField('strongFocus', $event.currentTarget.checked)"
          ></m3e-switch>
        </m3e-list-item>

      </m3e-list>
    </m3e-content-pane>
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
  padding: 28px 40px 20px;
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
  padding: 24px 40px 48px;
  @include scrollbar-dark;
}

.appearance-settings__options {
  display: flex;
  width: min(640px, 100%);
  margin: 0;
  flex-direction: column;
}

.appearance-settings__toolbar {
  display: flex;
  width: min(640px, 100%);
  justify-content: flex-end;
  margin-bottom: 4px;
}

/* --- 单行选项 --- */
.appearance-settings__option {
  width: 100%;
}

.appearance-settings__group {
  display: block;
  margin: 24px 16px 8px;
  color: var(--md-sys-color-primary);
}

.appearance-settings__group:first-child { margin-top: 8px; }

.appearance-settings__color-control {
  display: flex;
  align-items: center;
  gap: 12px;
}

.appearance-settings__color-value {
  color: var(--md-sys-color-on-surface-variant);
  font-family: ui-monospace, "Cascadia Code", monospace;
  font-size: 13px;
  text-transform: uppercase;
}

.appearance-settings__color-control input {
  width: 48px;
  height: 40px;
  padding: 3px;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: var(--md-sys-shape-corner-small);
  background: transparent;
  cursor: pointer;
}

/* --- 选择器固定宽度 --- */
.appearance-settings__select {
  width: 160px;
  flex: 0 0 auto;
}

/* --- 移动端适配 --- */
@media (max-width: 760px) {
  .appearance-settings__header { padding: 22px 20px 16px; }
  .appearance-settings__body { padding: 20px 20px 40px; }
  .appearance-settings__select { width: 100%; }
}
</style>
