<!--
供应商模型列表：展示已选模型，支持从供应商发现模型、手动添加和移除，弹窗内切换选中模型。
数据只通过 update:models 交给上层；发现请求、手动输入和弹窗开关是本地状态。
控件全部使用 KIMA：KimaTextField、KimaButton、KimaIconButton、KimaList、KimaDialog。
调用示例：<ProviderModels :provider="provider" :models="provider.models" @update:models="setModels" />
-->
<script setup>
import { ref } from 'vue'
import { KimaButton, KimaDialog, KimaFlex, KimaIconButton, KimaList, KimaTextField, KimaTypography } from '@kernel4632/kima'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { Settings } from '../../commands/settings.js'

const props = defineProps({ provider: Object, models: Array })
const emit = defineEmits(['update:models'])
const manual = ref('')
const loading = ref(false)
const chooserOpen = ref(false)
const available = ref([])

function add() {
  const id = manual.value.trim()
  if (!id) return
  if (!props.models.some(model => model.id === id)) emit('update:models', [...props.models, { id, name: id, capabilities: ['文本', '工具'] }])
  manual.value = ''
}

async function discover() {
  if (loading.value) return
  loading.value = true
  try { available.value = await Settings.discoverModels(props.provider, props.models); chooserOpen.value = true }
  finally { loading.value = false }
}

function removeModel(id) {
  emit('update:models', props.models.filter(item => item.id !== id))
}
</script>

<template>
  <KimaFlex direction="column" :gap="3">
    <KimaFlex justify="space-between" align="center">
      <KimaTypography type="heading" :level="3" size="title-small">模型列表</KimaTypography>
      <KimaButton variant="text" :disabled="loading" @click="discover">{{ loading ? '获取中…' : '获取模型列表' }}</KimaButton>
    </KimaFlex>

    <KimaFlex :gap="2" align="end">
      <KimaTextField
        v-model="manual"
        label="手动添加模型 ID"
        placeholder="输入模型 ID"
        @keydown.enter.prevent="add"
      />
      <KimaButton :disabled="!manual.trim()" @click="add">添加模型</KimaButton>
    </KimaFlex>

    <KimaList :items="models.map(model => ({ id: model.id, title: model.name }))" empty-text="尚未添加模型">
      <template #action="{ item }">
        <KimaIconButton
          :icon="Cancel01Icon"
          :label="`移除模型 ${item.title}`"
          variant="text"
          @click="removeModel(item.id)"
        />
      </template>
    </KimaList>
  </KimaFlex>

  <KimaDialog :open="chooserOpen" title="选择模型" @update:open="chooserOpen = $event">
    <KimaFlex direction="column" :gap="2">
      <KimaButton
        v-for="model in available"
        :key="model.id"
        variant="tonal"
        :aria-pressed="models.some(item => item.id === model.id)"
        @click="emit('update:models', Settings.toggleModelInList(models, model))"
      >{{ model.name }}</KimaButton>
    </KimaFlex>
    <template #footer>
      <KimaButton variant="text" @click="chooserOpen = false">关闭</KimaButton>
    </template>
  </KimaDialog>
</template>
