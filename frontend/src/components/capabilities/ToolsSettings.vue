<!--
工具权限：最上面一个「默认动作」，下面每个工具可以单独覆盖。
allow 直接执行；review 先让 AI 审核，审核器不确定时再问你；ask 每次询问；deny 直接拒绝。
默认动作只写全局 *，不改写每个工具已经记住的规则；明确拒绝仍然生效。
调用示例：<ToolsSettings :draft="draft" />。
-->
<script setup>
import { computed } from 'vue'
import Select from '../../ui/Select.vue'
import SettingsList from '../../ui/SettingsList.vue'
import SettingsRow from '../../ui/SettingsRow.vue'

const props = defineProps({
  draft: { type: Object, required: true },
})
const tools = computed(() => props.draft.tools || [])

// 工具行用短标签；全局默认动作说清范围和后果。
const toolActions = [
  { value: 'ask', label: '每次询问' },
  { value: 'review', label: 'AI 审核' },
  { value: 'allow', label: '直接执行' },
  { value: 'deny', label: '拒绝' },
]
const defaultActions = [
  { value: 'ask', label: '每次询问' },
  { value: 'review', label: '全部 AI 审核' },
  { value: 'allow', label: '全部批准' },
  { value: 'deny', label: '全部拒绝' },
]

// 后端没有为 other 这类工具准备中文类别名，界面上统一叫“自定义”。
const kindLabel = tool => tool.kind === 'other' ? '自定义' : (tool.kindLabel || '工具')

function setTool(tool, permission) {
  props.draft.tools = tools.value.map(item => item.name === tool.name ? { ...item, permission } : item)
}

function setDefault(permission) {
  props.draft.defaultAction = permission
}
</script>

<template>
  <section class="tools-settings" aria-label="工具管理">
    <SettingsList v-if="tools.length" title="工具权限">
      <SettingsRow title="默认动作" description="没有单独设置的工具按这个动作处理。AI 审核需要先在「自动审核」里启用">
        <Select
          class="tools-settings__select"
          label="默认动作"
          :model-value="draft.defaultAction || 'ask'"
          :items="defaultActions"
          @update:model-value="setDefault"
        />
      </SettingsRow>
      <SettingsRow v-for="tool in tools" :key="tool.name" :title="tool.title || tool.name" :description="`${kindLabel(tool)} · ${tool.name}`">
        <Select
          class="tools-settings__select"
          :label="`${tool.title || tool.name} 权限`"
          :model-value="tool.permission"
          :items="toolActions"
          @update:model-value="setTool(tool, $event)"
        />
      </SettingsRow>
    </SettingsList>
    <p v-else class="tools-settings__empty">暂无可配置的工具</p>
  </section>
</template>

<style scoped lang="scss" src="../../styles/components/capabilities/ToolsSettings.scss"></style>
