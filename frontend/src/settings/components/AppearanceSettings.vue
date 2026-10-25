<!--
外观设置：主题、强调色、动画和键盘焦点偏好；所有改动只通过 change 事件交给上层写回草稿。
控件全部使用 KIMA：KimaRadioGroup、KimaSelect、KimaSwitch、KimaButton、KimaDivider、KimaFlex、KimaGrid、KimaTypography。
-->
<script setup>
import { computed } from 'vue'
import { KimaButton, KimaDivider, KimaFlex, KimaGrid, KimaRadioGroup, KimaSwitch, KimaTypography } from '@kernel4632/kima'
import { Select } from '../../ui/index.js'
import { DEFAULT_APPEARANCE } from '../../theme/index.js'

const props = defineProps({ appearance: { type: Object, required: true } })
const emit = defineEmits(['change'])
const update = (field, value) => emit('change', { field, value })

const themes = [{ value: 'dark', label: '深色' }, { value: 'light', label: '浅色' }, { value: 'system', label: '跟随系统' }]
const PRESET_COLORS = [
  { value: '#3b5cf6', label: '靛蓝' },
  { value: '#8badf4', label: '雾蓝' },
  { value: '#85bfb1', label: '青绿' },
  { value: '#c9b69a', label: '暖沙' },
  { value: '#bba5d6', label: '丁香' },
]
// 旧版本存过自定义颜色，列表里找不到匹配项时下拉框会显示空白，这里补一个当前值。
const colors = computed(() => {
  const current = props.appearance.color
  if (!current || PRESET_COLORS.some(item => item.value === current)) return PRESET_COLORS
  return [{ value: current, label: '当前颜色' }, ...PRESET_COLORS]
})

function reset() {
  for (const [field, value] of Object.entries(DEFAULT_APPEARANCE)) update(field, value)
}
</script>

<template>
  <KimaFlex direction="column" :gap="4">
    <KimaTypography type="heading" :level="3" size="title-small">外观</KimaTypography>

    <KimaGrid :columns="{ base: 1, md: 2 }" :gap="4">
      <KimaFlex direction="column" :gap="2">
        <KimaTypography>界面主题</KimaTypography>
        <KimaTypography type="caption">选择工作区的显示方式</KimaTypography>
        <KimaRadioGroup
          label="界面主题"
          name="theme"
          orientation="horizontal"
          :options="themes"
          :model-value="appearance.theme"
          @update:model-value="update('theme', $event)"
        />
      </KimaFlex>

      <KimaFlex direction="column" :gap="2">
        <KimaTypography>强调色</KimaTypography>
        <KimaTypography type="caption">按钮与选中状态的颜色</KimaTypography>
        <Select
          label="强调色"
          :options="colors"
          :model-value="appearance.color"
          @update:model-value="update('color', $event)"
        />
      </KimaFlex>
    </KimaGrid>

    <KimaDivider />

    <KimaTypography type="heading" :level="3" size="title-small">通用</KimaTypography>
    <KimaSwitch :model-value="appearance.reduceMotion" @update:model-value="update('reduceMotion', $event)">减少界面动画</KimaSwitch>
    <KimaSwitch :model-value="appearance.strongFocus" @update:model-value="update('strongFocus', $event)">增强键盘焦点</KimaSwitch>

    <KimaDivider />

    <KimaFlex justify="space-between" align="center" :gap="3">
      <KimaTypography type="caption">外观偏好保存在当前浏览器</KimaTypography>
      <KimaButton variant="text" @click="reset">恢复默认</KimaButton>
    </KimaFlex>
  </KimaFlex>
</template>
