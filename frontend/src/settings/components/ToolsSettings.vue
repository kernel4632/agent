<!--
工具管理：默认是工具列表，点一行进入该工具的权限页。
列表只负责选择；权限页用 自有 RadioGroup 选自动执行 / 每次询问 / 禁止调用。
核心数据：tools（每项含 name、title、kind、permission）；开关不再另存一份 enabled。
调用示例：<ToolsSettings v-model:tools="draft.tools" :detail="detail" @open-detail="..." @close-detail="..." />
-->
<script setup>
import { computed } from 'vue'
import { RadioGroup } from '../../ui/index.js'
import { AppIcon, Button, ChoiceContent } from '../../ui/index.js'

const props = defineProps({
  tools: { type: Array, required: true },
  detail: { type: Object, default: null },
})
const emit = defineEmits(['update:tools', 'open-detail', 'close-detail', 'update-detail-title'])

// 类别名由后端工具目录带过来；“自定义”只补在目录里没出现过的 other。
const kindLabel = tool => tool.kindLabel || (tool.kind === 'other' ? '自定义' : '工具')

const PERMISSION_OPTIONS = [
  { value: 'allow', label: '自动执行', description: '不弹审批，直接执行', icon: 'check' },
  { value: 'ask', label: '每次询问', description: '执行前先问你一句', icon: 'info' },
  { value: 'deny', label: '禁止调用', description: '请求会被拒绝，模型仍能看到这个工具', icon: 'close' },
]
const permissionLabel = permission => PERMISSION_OPTIONS.find(item => item.value === permission)?.label || '每次询问'

const selected = computed(() => props.detail
  ? props.tools.find(tool => tool.name === props.detail.id) ?? null
  : null)

function updatePermission(name, permission) {
  const updated = props.tools.map(tool => tool.name === name ? { ...tool, permission } : tool)
  emit('update:tools', updated)
  if (props.detail?.id === name) emit('update-detail-title', props.tools.find(tool => tool.name === name)?.title || name)
}
</script>

<template>
  <section v-if="!detail" class="tools-settings" aria-label="工具管理">
    <header class="tools-head">
      <p>控制每个工具是否可用，以及调用前是否需要先问你。</p>
    </header>

    <div v-if="tools.length" class="settings-list">
      <Button
        v-for="tool in tools"
        :key="tool.name"
        variant="plain"
        class="tool-row"
        @click="emit('open-detail', { id: tool.name, title: tool.title || tool.name })"
      >
        <span class="tool-row__icon" aria-hidden="true"><AppIcon :name="tool.ui?.icon || 'code'" :size="20" /></span>
        <span class="tool-row__copy">
          <strong>{{ tool.title || tool.name }}</strong>
          <small>{{ kindLabel(tool) }} · {{ tool.name }}</small>
        </span>
        <span class="tool-row__state" :class="{ 'is-deny': tool.permission === 'deny' }">{{ permissionLabel(tool.permission) }}</span>
        <AppIcon name="arrow" :size="16" class="tool-row__arrow" aria-hidden="true" />
      </Button>
    </div>
    <p v-else class="tools-settings__empty">暂无可配置的工具</p>
  </section>

  <section v-else-if="selected" class="tool-detail" aria-label="工具权限">
    <header class="tool-detail__head">
      <span class="tool-detail__icon" aria-hidden="true"><AppIcon :name="selected.ui?.icon || 'code'" :size="22" /></span>
      <div>
        <h3>{{ selected.title || selected.name }}</h3>
        <p>{{ kindLabel(selected) }} · {{ selected.name }}</p>
      </div>
    </header>

    <RadioGroup
      label="权限"
      :model-value="selected.permission"
      :options="PERMISSION_OPTIONS"
      @update:model-value="updatePermission(selected.name, $event)"
    >
      <template #option="{ item, selected: on }">
        <ChoiceContent
          :selected="on"
          :show-mark="false"
          :icon="item.icon"
          :title="item.label"
          :hint="item.description"
        />
      </template>
    </RadioGroup>
  </section>

  <div v-else class="tool-missing">
    <p>这个工具已经不存在了。</p>
    <Button @click="emit('close-detail')">返回工具列表</Button>
  </div>
</template>

<style scoped lang="scss" src="../../styles/settings/components/ToolsSettings.scss"></style>
