<script setup>
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
      <label class="preference-row"><span><strong>减少界面动画</strong><small>关闭过渡动画，减少视觉干扰</small></span><input class="switch" type="checkbox" role="switch" aria-label="减少界面动画" :checked="appearance.reduceMotion" @change="update('reduceMotion', $event.target.checked)" /></label>
      <label class="preference-row"><span><strong>增强键盘焦点</strong><small>让键盘操作的位置更清晰</small></span><input class="switch" type="checkbox" role="switch" aria-label="增强键盘焦点" :checked="appearance.strongFocus" @change="update('strongFocus', $event.target.checked)" /></label>
    </section>
    <footer><span>外观偏好保存在当前浏览器。</span><button class="text-button" @click="reset">恢复默认</button></footer>
  </div>
</template>

<style scoped lang="scss">
.preference-group {
  margin-bottom: 24px;
  h3 { margin: 0 0 10px; font-size: 13px; font-weight: 500; }
}
.preference-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 66px;
  padding: 14px 16px;
  margin-bottom: 2px;
  background: var(--la-setting-row);

  &:nth-child(2) { border-radius: 7px 7px 0 0; }
  &:last-child { border-radius: 0 0 7px 7px; }
  strong { display: block; font-size: 13px; font-weight: 450; }
  small { display: block; margin-top: 5px; color: var(--la-secondary); font-size: 11px; line-height: 1.5; }
}
fieldset { display: flex; flex: none; gap: 4px; margin: 0; padding: 0; border: 0; }
.theme-options {
  padding: 3px;
  border-radius: 6px;
  background: var(--la-panel);

  label { position: relative; padding: 6px 8px; border-radius: 4px; color: var(--la-secondary); font-size: 11px; cursor: pointer; }
  label.selected { color: var(--la-text); background: var(--la-setting-row); }
  input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  label:focus-within { outline: 2px solid var(--la-accent); }
}
.color-options {
  gap: 8px;
  label { position: relative; display: block; width: 24px; height: 24px; cursor: pointer; }
  input { position: absolute; opacity: 0; }
  span { display: block; width: 24px; height: 24px; border: 4px solid var(--la-setting-row); border-radius: 50%; background: var(--swatch); }
  input:checked + span { outline: 1px solid var(--swatch); }
  input:focus-visible + span { outline: 2px solid var(--la-text); }
}
footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--la-muted); font-size: 11px; }
@media (max-width: 540px) {
  .preference-row { flex-wrap: wrap; padding: 14px 12px; }
  .theme-options { margin-left: auto; }
}
</style>
