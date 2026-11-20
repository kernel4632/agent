<!--
技能（设置页「能力」组里的分类）：一张分组卡片，每个技能一行（书本图标、标题、SKILL.md 的第一行说明），右边是启用开关。
关掉的技能写进 config.skills.disabled，模型就看不到它的目录项。没装技能时给出放哪儿的提示。
-->
<script setup>
import { onMounted, ref } from 'vue'
import { BookOpen01Icon } from '@hugeicons/core-free-icons'

const props = defineProps({ api: { type: Object, required: true }, ui: { type: Object, required: true } })
const ui = props.ui
const items = ref(null)
const busy = ref('')

async function load() { items.value = await props.api.op('skill.list') }
async function toggle(item, enabled) {
    busy.value = item.name
    try { items.value = await props.api.op('skill.toggle', { name: item.name, enabled }) }
    finally { busy.value = '' }
}

onMounted(load)
</script>

<template>
  <p class="ui-hint">技能是带 SKILL.md 的文件夹，放在项目的 skills/、~/.agents/skills/ 或数据目录的 skills/ 里。模型需要时用 skill 工具读全文。</p>
  <ui.List v-if="items?.length">
    <ui.Row
      v-for="item in items" :key="item.name" :icon="BookOpen01Icon" :tone="item.enabled ? 'success' : ''"
      :title="item.title" :description="item.description || item.name"
    >
      <ui.Switch :model-value="item.enabled" :disabled="busy === item.name" :label="`启用 ${item.title}`" @update:model-value="toggle(item, $event)" />
    </ui.Row>
  </ui.List>
  <ui.Empty v-else-if="items" :icon="BookOpen01Icon" title="还没有安装技能" text="把带 SKILL.md 的目录放进 skills/ 再回来看看" />
</template>
