<!--
智能体切换底部抽屉：和通用编码智能体的角色切换一样，单独入口、单独抽屉，打开就能直接选。
选项交给 自有 RadioGroup，单选、方向键和 ARIA 都由组件负责；每行内容用 #option 插槽画成卡片。
调用示例：<AgentPicker :open="open" :model-value="session.settings.agent" @select="Session.setAgent(session.id, $event)" />
-->
<script setup>
import { computed } from 'vue'
import { RadioGroup } from '../ui/index.js'
import { ChoiceContent, Sheet } from '../ui/index.js'
import { store } from '../store.js'

const props = defineProps({
  open: Boolean,
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:open', 'select'])

const agents = computed(() => store.config.agents || [])

function iconOf(agent) {
  if (agent.name === 'ask') return 'chat'
  if (agent.name === 'debug') return 'search'
  return agent.readOnly ? 'eye' : 'code'
}

const options = computed(() => agents.value.map(agent => ({
  value: agent.name,
  label: agent.label,
  description: [
    agent.description || (agent.readOnly ? '只保留只读工具' : '可以改文件、执行命令'),
    agent.model ? `模型：${agent.model.provider} / ${agent.model.model}` : '',
  ].filter(Boolean).join(' · '),
  icon: iconOf(agent),
})))

function choose(value) {
  emit('select', value)
  emit('update:open', false)
}
</script>

<template>
  <Sheet
    :open="open"
    label="切换智能体"
    description="选一个现在要用的智能体，选完立即保存。"
    :width="608"
    @update:open="emit('update:open', $event)"
  >
    <div class="agent-drawer">
      <RadioGroup
        label="智能体"
        :model-value="modelValue"
        :options="options"
        @update:model-value="choose"
      >
        <template #option="{ item, selected }">
          <ChoiceContent
            :selected="selected"
            :show-mark="false"
            :icon="item.icon"
            :title="item.label"
            :hint="item.description"
          />
        </template>
      </RadioGroup>
    </div>
  </Sheet>
</template>

<style scoped lang="scss" src="../styles/components/AgentPicker.scss"></style>
