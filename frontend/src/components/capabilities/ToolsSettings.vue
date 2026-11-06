<!--
工具权限：一页列出全部工具，每个工具一个开关。
打开表示直接执行，关闭表示每次调用前先询问；不再有禁止调用，也没有二级页面。
调用示例：<ToolsSettings :draft="draft" />。
-->
<script setup>
import { computed } from 'vue'
import Switch from '../../ui/Switch.vue'
import SettingsList from '../../ui/SettingsList.vue'
import SettingsRow from '../../ui/SettingsRow.vue'

const props = defineProps({
  draft: { type: Object, required: true },
})
const tools = computed(() => props.draft.tools)

// 后端没有为 other 这类工具准备中文类别名，界面上统一叫“自定义”。
const kindLabel = tool => tool.kind === 'other' ? '自定义' : (tool.kindLabel || '工具')
const isAllowed = tool => tool.permission === 'allow'

function toggle(tool, allowed) {
  props.draft.tools = props.draft.tools.map(item => item.name === tool.name
    ? { ...item, permission: allowed ? 'allow' : 'ask' }
    : item)
}
</script>

<template>
  <section class="tools-settings" aria-label="工具管理">
    <SettingsList v-if="tools.length" title="工具权限">
      <SettingsRow v-for="tool in tools" :key="tool.name" :title="tool.title || tool.name" :description="`${kindLabel(tool)} · ${tool.name}`">
        <Switch
          :model-value="isAllowed(tool)"
          :label="`${tool.title || tool.name} 自动执行`"
          hide-label
          @update:model-value="toggle(tool, $event)"
        />
      </SettingsRow>
    </SettingsList>
    <p v-else class="tools-settings__empty">暂无可配置的工具</p>
  </section>
</template>

<style scoped lang="scss" src="../../styles/components/capabilities/ToolsSettings.scss"></style>
