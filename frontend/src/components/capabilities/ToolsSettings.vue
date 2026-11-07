<!--
工具权限：最上面一个「全部批准」，下面每个工具一个开关。
全部批准打开后，所有可配置工具直接执行，不再弹出批准。
单个开关打开表示这个工具直接执行，关闭表示每次调用前先询问；不再有禁止调用，也没有二级页面。
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
const tools = computed(() => props.draft.tools || [])

// 后端没有为 other 这类工具准备中文类别名，界面上统一叫“自定义”。
const kindLabel = tool => tool.kind === 'other' ? '自定义' : (tool.kindLabel || '工具')
const isAllowed = tool => tool.permission === 'allow'
const allAllowed = computed(() => tools.value.length > 0 && tools.value.every(isAllowed))

function setPermission(tool, allowed) {
  return { ...tool, permission: allowed ? 'allow' : 'ask' }
}

function toggle(tool, allowed) {
  props.draft.tools = tools.value.map(item => item.name === tool.name ? setPermission(item, allowed) : item)
}

function setAll(allowed) {
  props.draft.tools = tools.value.map(item => setPermission(item, allowed))
}
</script>

<template>
  <section class="tools-settings" aria-label="工具管理">
    <SettingsList v-if="tools.length" title="工具权限">
      <SettingsRow title="全部批准" description="打开后所有工具直接执行，不再弹出批准">
        <Switch
          :model-value="allAllowed"
          label="全部批准"
          hide-label
          @update:model-value="setAll"
        />
      </SettingsRow>
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
