<!--
对话设置：控制工具过程在回答里的展开行为，属于阅读偏好，不改变模型请求。
调用示例：<ConversationSettings :draft="draft" />。
-->
<script setup>
import Switch from '../../ui/Switch.vue'
import SettingsList from '../../ui/SettingsList.vue'
import SettingsRow from '../../ui/SettingsRow.vue'

const props = defineProps({ draft: { type: Object, required: true } })

const setAutoExpand = value => {
  props.draft.appearance.autoExpandTools = value
}
</script>

<template>
  <section class="conversation-settings" aria-label="对话">
    <SettingsList title="工具过程">
      <SettingsRow
        title="自动展开和收起"
        description="工具执行时自动展开过程，结束后自动收起。关闭后需要手动点开每一步"
      >
        <Switch
          :model-value="draft.appearance.autoExpandTools !== false"
          label="自动展开和收起工具过程"
          hide-label
          @update:model-value="setAutoExpand"
        />
      </SettingsRow>
    </SettingsList>
  </section>
</template>

<style scoped lang="scss" src="../../styles/components/preferences/ConversationSettings.scss"></style>
