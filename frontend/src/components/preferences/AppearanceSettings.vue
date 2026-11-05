<!--
外观设置：主题、强调色、调色板风格、对比度、圆角、密度、动效和键盘焦点偏好；直接编辑传入的隔离草稿。
强调色支持预设色板 + 原生取色器；变体/对比度/圆角/密度/动效是可视化自定义主区。
控件全部使用自有控件：RadioGroup、Select、Switch、Button；保存由 SettingsView 统一触发。
调用示例：<AppearanceSettings :draft="draft" />。
-->
<script setup>
import { computed } from 'vue'
import RadioGroup from '../../ui/RadioGroup.vue'
import Select from '../../ui/Select.vue'
import Button from '../../ui/Button.vue'
import Switch from '../../ui/Switch.vue'
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
    <h3 class="appearance-title">外观</h3>

    <div class="appearance-sections">
      <div class="appearance-field">
        <p class="appearance-label">界面主题</p>
        <p class="appearance-caption">选择工作区的显示方式</p>
        <RadioGroup
          label="界面主题"
          name="theme"
          orientation="horizontal"
          :options="themes"
          :model-value="appearance.theme"
          @update:model-value="update('theme', $event)"
        />
      </div>

      <div class="appearance-field">
        <p class="appearance-label">强调色</p>
        <p class="appearance-caption">按钮与选中状态的颜色</p>
        <!-- 色板：点色块直接选，所见即所得 -->
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
          <!-- 原生取色器：任何颜色都能选 -->
          <label class="appearance-swatch appearance-swatch--custom" title="自定义颜色">
            <input
              type="color"
              :value="appearance.color"
              aria-label="自定义强调色"
              @input="update('color', $event.target.value)"
            />
            <span aria-hidden="true">+</span>
          </label>
        </div>
      </div>

      <div class="appearance-field">
        <p class="appearance-label">配色风格</p>
        <p class="appearance-caption">同一强调色在不同方案下的整体观感</p>
        <Select
          class="appearance-color"
          label="配色风格"
          :items="VARIANTS"
          :model-value="appearance.variant"
          @update:model-value="update('variant', $event)"
        />
      </div>

      <div class="appearance-field">
        <p class="appearance-label">对比度</p>
        <p class="appearance-caption">文字与背景的对比强度</p>
        <RadioGroup
          label="对比度"
          name="contrast"
          orientation="horizontal"
          :options="CONTRASTS"
          :model-value="appearance.contrast"
          @update:model-value="update('contrast', $event)"
        />
      </div>
    </div>

    <hr class="ui-divider" />

    <h3 class="appearance-title">形状与密度</h3>
    <div class="appearance-sections">
      <div class="appearance-field">
        <p class="appearance-label">圆角</p>
        <p class="appearance-caption">控件与面板的圆角大小 · {{ radiusLabel }}</p>
        <input
          class="appearance-slider"
          type="range"
          min="0"
          max="24"
          step="1"
          :value="appearance.radius ?? 10"
          aria-label="圆角大小"
          @input="update('radius', Number($event.target.value))"
        />
      </div>

      <div class="appearance-field">
        <p class="appearance-label">密度</p>
        <p class="appearance-caption">界面元素之间的留白</p>
        <RadioGroup
          label="密度"
          name="density"
          orientation="horizontal"
          :options="[{ value: -1, label: '紧凑' }, { value: 0, label: '标准' }, { value: 1, label: '宽松' }]"
          :model-value="appearance.density"
          @update:model-value="update('density', Number($event))"
        />
      </div>
    </div>

    <hr class="ui-divider" />

    <h3 class="appearance-title">通用</h3>
    <div class="appearance-sections">
      <div class="appearance-field">
        <p class="appearance-label">动效速度</p>
        <p class="appearance-caption">过渡动画的整体节奏</p>
        <RadioGroup
          label="动效速度"
          name="motion"
          orientation="horizontal"
          :options="MOTIONS"
          :model-value="appearance.motion"
          @update:model-value="update('motion', $event)"
        />
      </div>
      <Switch :model-value="appearance.reduceMotion" label="减少界面动画" @update:model-value="update('reduceMotion', $event)" />
      <Switch :model-value="appearance.strongFocus" label="增强键盘焦点" @update:model-value="update('strongFocus', $event)" />
    </div>

    <hr class="ui-divider" />

    <div class="appearance-footer">
      <p class="appearance-caption">外观偏好保存在当前浏览器</p>
      <Button variant="text" @click="reset">恢复默认</Button>
    </div>
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/preferences/AppearanceSettings.scss"></style>
