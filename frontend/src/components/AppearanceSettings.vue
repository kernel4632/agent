<!--
外观设置：主题、强调色、动画和键盘焦点偏好；直接编辑传入的隔离草稿。
控件全部使用 自有控件：RadioGroup、Select、Divider、Flex、Typography；普通开关和按钮走 ui/Switch、ui/Button。
调用示例：<AppearanceSettings :draft="draft" />；保存由 SettingsView 统一触发。
-->
<script setup>
import { computed } from 'vue'
import { Divider, Flex, RadioGroup, Select, Typography } from '../ui/index.js'
import { Button, Switch } from '../ui/index.js'
import { DEFAULT_APPEARANCE } from '../store.js'

const props = defineProps({ draft: { type: Object, required: true } })
const appearance = computed(() => props.draft.appearance)
const update = (field, value) => { props.draft.appearance[field] = value }

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
  const current = props.draft.appearance.color
  if (!current || PRESET_COLORS.some(item => item.value === current)) return PRESET_COLORS
  return [{ value: current, label: '当前颜色' }, ...PRESET_COLORS]
})

function reset() {
  for (const [field, value] of Object.entries(DEFAULT_APPEARANCE)) update(field, value)
}
</script>

<template>
  <Flex class="appearance-card" direction="column" :gap="4">
    <Typography type="heading" :level="3" size="title-small">外观</Typography>

    <Flex direction="column" :gap="6">
      <Flex direction="column" :gap="2">
        <Typography>界面主题</Typography>
        <Typography type="caption">选择工作区的显示方式</Typography>
        <RadioGroup
          label="界面主题"
          name="theme"
          orientation="horizontal"
          :options="themes"
          :model-value="appearance.theme"
          @update:model-value="update('theme', $event)"
        />
      </Flex>

      <Flex direction="column" :gap="2">
        <Typography>强调色</Typography>
        <Typography type="caption">按钮与选中状态的颜色</Typography>
        <Select
          class="appearance-color"
          label="强调色"
          :items="colors"
          :model-value="appearance.color"
          @update:model-value="update('color', $event)"
        />
      </Flex>
    </Flex>

    <Divider />

    <Typography type="heading" :level="3" size="title-small">通用</Typography>
    <Switch :model-value="appearance.reduceMotion" label="减少界面动画" @update:model-value="update('reduceMotion', $event)" />
    <Switch :model-value="appearance.strongFocus" label="增强键盘焦点" @update:model-value="update('strongFocus', $event)" />

    <Divider />

    <Flex justify="space-between" align="center" :gap="3">
      <Typography type="caption">外观偏好保存在当前浏览器</Typography>
      <Button variant="text" @click="reset">恢复默认</Button>
    </Flex>
  </Flex>
</template>

<style scoped lang="scss" src="../styles/components/AppearanceSettings.scss"></style>
