<!--
外观设置：主题、强调色、调色板风格、对比度、圆角、密度、动效和键盘焦点偏好；直接编辑传入的隔离草稿。
统一采用设置列表行：左侧标题和说明，右侧下拉、滑条或开关。
调用示例：<AppearanceSettings :draft="draft" />。
-->
<script setup>
import { computed } from 'vue'
import RadioGroup from '../../ui/RadioGroup.vue'
import Select from '../../ui/Select.vue'
import Button from '../../ui/Button.vue'
import Switch from '../../ui/Switch.vue'
import SettingsList from '../../ui/SettingsList.vue'
import SettingsRow from '../../ui/SettingsRow.vue'
import { DEFAULT_APPEARANCE } from '../../store.js'

const props = defineProps({ draft: { type: Object, required: true } })
const appearance = computed(() => props.draft.appearance)
const update = (field, value) => { props.draft.appearance[field] = value }

// --- 界面主题：三选一，跟随系统时由 App.vue 监听系统色 ---
const themes = [{ value: 'dark', label: '深色' }, { value: 'light', label: '浅色' }, { value: 'system', label: '跟随系统' }]

// --- 强调色：预设色板 + 原生取色器自由选 ---
const PRESET_COLORS = [
  { value: '#3b5cf6', label: '靛蓝' },
  { value: '#8badf4', label: '雾蓝' },
  { value: '#85bfb1', label: '青绿' },
  { value: '#c9b69a', label: '暖沙' },
  { value: '#bba5d6', label: '丁香' },
  { value: '#d67070', label: '珊瑚' },
  { value: '#d68c27', label: '琥珀' },
  { value: '#50fa7b', label: '荧光绿' },
  { value: '#ff79c6', label: '粉红' },
]
// 旧版本存过自定义颜色，列表里找不到匹配项时下拉框会显示空白，这里补一个当前值。
const colors = computed(() => {
  const current = props.draft.appearance.color
  if (!current || PRESET_COLORS.some(item => item.value === current)) return PRESET_COLORS
  return [{ value: current, label: '当前颜色' }, ...PRESET_COLORS]
})

// --- 调色板风格：同一强调色在不同变体下生成完全不同的界面配色（Material 调色方案） ---
const VARIANTS = [
  { value: 'tonal-spot', label: '标准（跟随强调色）' },
  { value: 'neutral', label: '素雅（几乎无彩色）' },
  { value: 'vibrant', label: '鲜艳（高饱和）' },
  { value: 'expressive', label: '活泼（偏移色相）' },
  { value: 'fidelity', label: '忠实（贴近强调色）' },
  { value: 'content', label: '内容（平衡方案）' },
  { value: 'rainbow', label: '彩虹（多彩点缀）' },
  { value: 'fruit-salad', label: '果盘（撞色点缀）' },
  { value: 'monochrome', label: '黑白（纯灰阶）' },
]

// --- 对比度：影响文字与背景的对比强度 ---
const CONTRASTS = [
  { value: 'standard', label: '标准' },
  { value: 'medium', label: '中等' },
  { value: 'high', label: '高' },
]

// --- 动效速度：影响所有过渡动画的时长 ---
const MOTIONS = [
  { value: 'standard', label: '标准' },
  { value: 'expressive', label: '优雅（放慢）' },
  { value: 'quick', label: '轻快（加快）' },
  { value: 'off', label: '关闭' },
]

// --- 圆角与密度的展示辅助文本 ---
const radiusLabel = computed(() => {
  const value = appearance.value.radius ?? 10
  if (value <= 2) return '方正'
  if (value >= 20) return '圆润'
  return `${value}px`
})

function reset() {
  for (const [field, value] of Object.entries(DEFAULT_APPEARANCE)) update(field, value)
}
</script>

<template>
  <div class="appearance-card">
    <SettingsList title="外观">
      <SettingsRow title="界面主题" description="选择工作区的显示方式">
        <RadioGroup compact label="界面主题" name="theme" orientation="horizontal" :options="themes" :model-value="appearance.theme" @update:model-value="update('theme', $event)" />
      </SettingsRow>
      <SettingsRow title="强调色" description="按钮与选中状态使用的主色">
        <div class="appearance-swatches" role="radiogroup" aria-label="强调色色板">
          <button
            v-for="item in colors"
            :key="item.value"
            type="button"
            class="appearance-swatch"
            :class="{ 'is-active': appearance.color === item.value }"
            :style="{ '--swatch': item.value }"
            :title="item.label"
            :aria-label="`强调色 ${item.label}`"
            :aria-pressed="appearance.color === item.value"
            @click="update('color', item.value)"
          ></button>
          <label class="appearance-swatch appearance-swatch--custom" title="自定义颜色">
            <input type="color" :value="appearance.color" aria-label="自定义强调色" @input="update('color', $event.target.value)" />
            <span aria-hidden="true">+</span>
          </label>
        </div>
      </SettingsRow>
      <SettingsRow title="配色风格" description="同一强调色在不同方案下的整体观感">
        <Select class="appearance-control" label="配色风格" :items="VARIANTS" :model-value="appearance.variant" @update:model-value="update('variant', $event)" />
      </SettingsRow>
      <SettingsRow title="对比度" description="文字与背景的对比强度">
        <RadioGroup compact label="对比度" name="contrast" orientation="horizontal" :options="CONTRASTS" :model-value="appearance.contrast" @update:model-value="update('contrast', $event)" />
      </SettingsRow>
    </SettingsList>

    <SettingsList title="形状与密度">
      <SettingsRow title="圆角" description="控件与面板的圆角大小">
        <div class="appearance-range-control">
          <input class="appearance-slider" type="range" min="0" max="24" step="1" :value="appearance.radius ?? 10" aria-label="圆角大小" @input="update('radius', Number($event.target.value))" />
          <span class="appearance-value">{{ radiusLabel }}</span>
        </div>
      </SettingsRow>
      <SettingsRow title="密度" description="界面元素之间的留白">
        <RadioGroup compact label="密度" name="density" orientation="horizontal" :options="[{ value: -1, label: '紧凑' }, { value: 0, label: '标准' }, { value: 1, label: '宽松' }]" :model-value="appearance.density" @update:model-value="update('density', Number($event))" />
      </SettingsRow>
    </SettingsList>

    <SettingsList title="通用">
      <SettingsRow title="动效速度" description="过渡动画的整体节奏">
        <RadioGroup compact label="动效速度" name="motion" orientation="horizontal" :options="MOTIONS" :model-value="appearance.motion" @update:model-value="update('motion', $event)" />
      </SettingsRow>
      <SettingsRow title="减少界面动画" description="减少装饰性动画，保留必要的状态反馈">
        <Switch :model-value="appearance.reduceMotion" label="减少界面动画" hide-label @update:model-value="update('reduceMotion', $event)" />
      </SettingsRow>
      <SettingsRow title="增强键盘焦点" description="让键盘焦点轮廓更明显">
        <Switch :model-value="appearance.strongFocus" label="增强键盘焦点" hide-label @update:model-value="update('strongFocus', $event)" />
      </SettingsRow>
    </SettingsList>

    <div class="appearance-footer">
      <p class="appearance-caption">外观偏好保存在当前浏览器</p>
      <Button variant="text" @click="reset">恢复默认</Button>
    </div>
  </div>
</template>>>

<style scoped lang="scss" src="../../styles/components/preferences/AppearanceSettings.scss"></style>
