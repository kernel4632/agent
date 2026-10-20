<!--
外观设置：主题、强调色、动画和键盘焦点偏好；所有改动只通过 change 事件交给上层写回草稿。
主题和颜色是专用单选控件，等组件库提供对应选择控件后再迁移；开关和恢复默认已经走 ui/。
调用示例：<AppearanceSettings :appearance="draft.appearance" @change="draft.appearance[$event.field] = $event.value" />
-->
<script setup>
import Button from '../../ui/Button.vue'
import Switch from '../../ui/Switch.vue'
import { DEFAULT_APPEARANCE } from '../../theme.js'
defineProps({ appearance: { type: Object, required: true } })
const emit = defineEmits(['change'])
const update = (field, value) => emit('change', { field, value })
const themes = [{ id: 'dark', label: '深色' }, { id: 'light', label: '浅色' }, { id: 'system', label: '跟随系统' }]
const colors = [{ value: '#8badf4', label: '雾蓝' }, { value: '#85bfb1', label: '青绿' }, { value: '#c9b69a', label: '暖沙' }, { value: '#bba5d6', label: '丁香' }]
function reset() { for (const [field, value] of Object.entries(DEFAULT_APPEARANCE)) update(field, value) }
</script>

<template>
  <div class="appearance-settings">
    <section class="preference-group">
      <h3>外观</h3>
      <!-- 主题和颜色单选框是专用选择控件，等组件库有对应选择控件再替换。 -->
      <div class="preference-row">
        <span><strong>界面主题</strong><small>选择工作区的显示方式</small></span>
        <fieldset class="theme-options"><legend class="sr-only">界面主题</legend><label v-for="theme in themes" :key="theme.id" :class="{ selected: appearance.theme === theme.id }"><input type="radio" name="theme" :checked="appearance.theme === theme.id" @change="update('theme', theme.id)" />{{ theme.label }}</label></fieldset>
      </div>
      <div class="preference-row">
        <span><strong>强调色</strong><small>按钮与选中状态的颜色</small></span>
        <fieldset class="color-options"><legend class="sr-only">强调色</legend><label v-for="color in colors" :key="color.value" :title="color.label" :style="{ '--swatch': color.value }"><input type="radio" name="accent" :aria-label="color.label" :checked="appearance.color === color.value" @change="update('color', color.value)" /><span></span></label></fieldset>
      </div>
    </section>
    <section class="preference-group">
      <h3>通用</h3>
      <label class="preference-row"><span><strong>减少界面动画</strong><small>关闭过渡动画，减少视觉干扰</small></span><Switch :model-value="appearance.reduceMotion" label="减少界面动画" @update:model-value="update('reduceMotion', $event)" /></label>
      <label class="preference-row"><span><strong>增强键盘焦点</strong><small>让键盘操作的位置更清晰</small></span><Switch :model-value="appearance.strongFocus" label="增强键盘焦点" @update:model-value="update('strongFocus', $event)" /></label>
    </section>
    <footer><span>外观偏好保存在当前浏览器。</span><Button variant="ghost" @click="reset">恢复默认</Button></footer>
  </div>
</template>

<style scoped lang="scss">
.preference-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
  h3 { margin: 0; color: var(--la-text); font-size: 13px; font-weight: 530; line-height: 16px; }
}
.preference-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 0;
  padding: 20px;
  margin: 0;
  background: var(--la-layer-01);
  border-bottom: .5px solid var(--la-line);

  &:nth-child(2) { border-radius: 8px 8px 0 0; }
  &:last-child { border-bottom: 0; border-radius: 0 0 8px 8px; }
  &:nth-child(2):last-child { border-radius: 8px; }
  strong { display: block; color: var(--la-text); font-size: 13px; font-weight: 530; line-height: 16px; }
  small { display: block; margin-top: 4px; color: var(--la-muted); font-size: 13px; font-weight: 440; line-height: 20px; }
}
fieldset { display: flex; flex: none; gap: 4px; margin: 0; padding: 0; border: 0; }
.theme-options {
  padding: 2px;
  border-radius: 6px;
  background: var(--la-layer-02);

  label { position: relative; padding: 4px 9px; border-radius: 4px; color: var(--la-muted); font-size: 13px; cursor: pointer; }
  label.selected { color: var(--la-text); background: var(--la-layer-03); }
  input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  label:focus-within { outline: 2px solid var(--la-accent); }
}
.color-options {
  gap: 8px;
  label { position: relative; display: block; width: 24px; height: 24px; cursor: pointer; }
  input { position: absolute; opacity: 0; }
  span { display: block; width: 22px; height: 22px; border: 2px solid var(--la-layer-01); border-radius: 50%; background: var(--swatch); }
  input:checked + span { outline: 1px solid var(--swatch); outline-offset: 1px; }
  input:focus-visible + span { outline: 2px solid var(--la-text); }
}
footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 4px; padding-top: 12px; border-top: .5px solid var(--la-line); color: var(--la-muted); font-size: 13px; }
@media (max-width: 540px) {
  .preference-row { flex-wrap: wrap; padding: 16px; }
  .theme-options { margin-left: auto; }
}
</style>
