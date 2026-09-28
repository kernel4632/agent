<script setup>
import AppIcon from '../AppIcon.vue'
import { DEFAULT_APPEARANCE } from '../../theme.js'
defineProps({ appearance: { type: Object, required: true } })
const emit = defineEmits(['change'])
const themes = [{ id: 'dark', label: '深色' }, { id: 'light', label: '浅色' }, { id: 'system', label: '跟随系统' }]
const colors = [{ value: '#8badf4', label: '雾蓝' }, { value: '#85bfb1', label: '青绿' }, { value: '#c9b69a', label: '暖沙' }, { value: '#bba5d6', label: '丁香' }]
const update = (field, value) => emit('change', { field, value })
function reset() { for (const [field, value] of Object.entries(DEFAULT_APPEARANCE)) update(field, value) }
</script>

<template>
  <div class="appearance-settings">
    <section class="appearance-section"><header><h3>界面主题</h3><p>让工作台适应你的环境。</p></header><fieldset class="theme-options"><legend class="sr-only">界面主题</legend><label v-for="theme in themes" :key="theme.id" class="theme-option" :class="{ selected: appearance.theme === theme.id }"><input type="radio" name="theme" :value="theme.id" :checked="appearance.theme === theme.id" @change="update('theme', theme.id)" /><span class="theme-preview" :class="`theme-preview--${theme.id}`"><i></i><span><b></b><b></b><em></em></span></span><span class="theme-option__label">{{ theme.label }}<AppIcon v-if="appearance.theme === theme.id" name="check" :size="14" /></span></label></fieldset></section>
    <section class="appearance-section"><header><h3>强调色</h3><p>为你的工作台添一点自己的色彩。</p></header><fieldset class="color-options"><legend class="sr-only">强调色</legend><label v-for="color in colors" :key="color.value" :class="{ selected: appearance.color === color.value }"><input type="radio" name="accent" :checked="appearance.color === color.value" @change="update('color', color.value)" /><span :style="{ background: color.value }"><AppIcon v-if="appearance.color === color.value" name="check" :size="16" /></span><small>{{ color.label }}</small></label></fieldset></section>
    <section class="appearance-section"><header><h3>舒适与可访问性</h3><p>专注内容，而不是界面本身。</p></header><div class="preference-rows"><label class="preference-row"><span><strong>减少界面动画</strong><small>关闭装饰动效和切换动画</small></span><input type="checkbox" role="switch" aria-label="减少界面动画" :checked="appearance.reduceMotion" @change="update('reduceMotion', $event.target.checked)" /></label><label class="preference-row"><span><strong>增强键盘焦点</strong><small>让键盘导航的位置更清晰</small></span><input type="checkbox" role="switch" aria-label="增强键盘焦点" :checked="appearance.strongFocus" @change="update('strongFocus', $event.target.checked)" /></label></div></section>
    <footer><span><AppIcon name="info" :size="14" />仅影响当前浏览器，不修改模型或后端配置。</span><button type="button" class="text-button" @click="reset">恢复默认</button></footer>
  </div>
</template>

<style scoped lang="scss">
.appearance-settings { max-width: 850px; width: 100%; margin: 0 auto; padding: 28px 32px 40px; }
.appearance-section { margin-bottom: 30px; }
.appearance-section header { margin-bottom: 16px; }
.appearance-section h3 { font-weight: 500; font-size: 14px; margin: 0 0 7px; }
.appearance-section p { font-size: 11px; color: var(--la-muted); margin: 0; line-height: 1.8; }
fieldset { border: 0; padding: 0; margin: 0; }
.theme-options { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; }
.theme-option { display: block; min-width: 0; cursor: pointer; border: 1px solid var(--la-line); border-radius: 11px; padding: 9px; position: relative; }
.theme-option.selected { border-color: var(--la-accent); background: var(--la-accent-soft); }
.theme-option > input, .color-options input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.theme-option:focus-within, .color-options label:focus-within { outline: 2px solid var(--la-accent); outline-offset: 4px; }
.theme-preview { height: 90px; display: flex; border: 1px solid #65718b22; background: #111823; border-radius: 6px; overflow: hidden; }
.theme-preview > i { width: 25%; background: #1e2632; border-right: 1px solid #9aafce22; }
.theme-preview > span { flex: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 7px; padding: 13px 10px 10px; }
.theme-preview b { display: block; width: 60%; height: 4px; background: #7789a64d; border-radius: 4px; }
.theme-preview b:nth-child(2) { width: 85%; }
.theme-preview em { width: 100%; height: 18px; margin-top: auto; border: 1px solid #a2b8d333; border-radius: 4px; background: #586d8e19; }
.theme-preview--light { background: #e7edf6; } .theme-preview--light > i { background: #c7d0dd; }
.theme-preview--system { background: linear-gradient(105deg, #111823 50%, #e7edf6 50%); }
.theme-option__label { display: flex; align-items: center; justify-content: space-between; margin: 11px 3px 3px; font-size: 11px; color: var(--la-secondary); }
.selected .theme-option__label { color: var(--la-accent); }
.color-options { display: flex; gap: 10px; }
.color-options label { position: relative; display: flex; align-items: center; gap: 7px; padding: 8px 10px; border: 1px solid var(--la-line); border-radius: 9px; cursor: pointer; }
.color-options label.selected { background: var(--la-hover); border-color: var(--la-accent-border); }
.color-options label > span { width: 24px; height: 24px; display: grid; place-items: center; color: #1e2c43; border-radius: 50%; }
.color-options small { color: var(--la-secondary); font-size: 11px; }
.preference-rows { border: 1px solid var(--la-line); border-radius: 11px; overflow: hidden; background: var(--la-hover); }
.preference-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 17px 18px; cursor: pointer; }
.preference-row + .preference-row { border-top: 1px solid var(--la-line); }
.preference-row strong { display: block; font-size: 12px; font-weight: 500; }
.preference-row small { display: block; font-size: 10px; color: var(--la-muted); margin-top: 6px; }
.preference-row input { appearance: none; position: relative; cursor: pointer; flex-shrink: 0; width: 36px; height: 21px; background: var(--la-muted); border: 0; border-radius: 20px; }
.preference-row input::after { content: ''; position: absolute; width: 15px; height: 15px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform .15s; }
.preference-row input:checked { background: var(--la-accent); }
.preference-row input:checked::after { transform: translateX(15px); background: #213455; }
footer { display: flex; justify-content: space-between; gap: 12px; padding-top: 8px; }
footer > span { display: flex; align-items: flex-start; gap: 7px; font-size: 10px; line-height: 1.8; color: var(--la-muted); }
footer svg { flex-shrink: 0; margin-top: 2px; }
footer button { flex-shrink: 0; align-self: start; font-size: 11px; }
@media (max-width: 760px) { .appearance-settings { padding: 24px 20px 32px; } .theme-options { gap: 8px; } .theme-preview { height: 66px; } .theme-option { padding: 6px; } .theme-preview > span { padding: 10px 6px 6px; } .color-options { display: grid; grid-template-columns: repeat(2, 1fr); } footer { flex-direction: column; } }
</style>
