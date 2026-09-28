<!--
模型管理面板：展示已添加模型列表，提供远程获取和批量选择能力。
设计思想：组件只触发指令和渲染结果，模型去重和切换逻辑由 commands/settings.js 完成。
核心数据：models（当前供应商已添加的模型数组）、availableModels（远程获取后的候选列表）。
调用示例：<ProviderModels :provider="provider" :models="provider.models" @update:models="updateProvider({ models: $event })" />。
-->
<script setup>
import { ref } from 'vue'                              // 引入响应式状态管理
import { Settings } from '../../commands/settings.js'  // 引入模型发现和切换指令
import { HugeiconsIcon } from '@hugeicons/vue'
import { CloudDownloadIcon, Delete01Icon, Tick01Icon, Add01Icon } from '@hugeicons/core-free-icons'
import { ICON_STROKE_WIDTH } from '../../theme.js'

const props = defineProps({
  provider: { type: Object, required: true },          // 接收当前供应商连接信息（用于远程获取）
  models: { type: Array, required: true },             // 接收当前已添加的模型数组
})
const emit = defineEmits(['update:models'])             // 输出变更后的模型数组

const chooserDialog = ref(null)                        // 远程模型选择弹窗引用
const availableModels = ref([])                        // 远程获取后的去重候选模型列表
const manualModel = ref('')
const loading = ref(false)

function addManualModel() {
  const id = manualModel.value.trim()
  if (!id) return
  if (!props.models.some(model => model.id === id)) emit('update:models', [...props.models, { id, name: id, capabilities: ['文本', '工具'] }])
  manualModel.value = ''
}


// --- 打开模型选择弹窗 ---
async function openChooser() {
  if (loading.value) return
  loading.value = true
  try {
    availableModels.value = await Settings.discoverModels(props.provider, props.models)
    chooserDialog.value.show()
  } finally { loading.value = false }
}


// --- 切换模型的添加状态 ---
function toggleModel(model) {
  const nextModels = Settings.toggleModelInList(props.models, model) // 调用指令完成添加或移除
  emit('update:models', nextModels)                    // 变更后的列表交给父组件写入草稿
}


// --- 移除已添加模型 ---
function removeModel(modelID) {
  emit('update:models', props.models.filter(model => model.id !== modelID)) // 过滤目标模型后上抛
}


</script>

<template>
  <section class="provider-models">
    <!-- 标题行：模型计数和获取按钮。 -->
    <div class="provider-models__heading">
      <m3e-heading variant="title" size="medium" level="3">模型列表 <span>{{ props.models.length }} 个已添加模型</span></m3e-heading>
      <m3e-button type="button" variant="outlined" :disabled="loading" @click="openChooser">
        <HugeiconsIcon slot="icon" :icon="CloudDownloadIcon" :stroke-width="ICON_STROKE_WIDTH" />
        {{ loading ? '获取中…' : '获取模型列表' }}
      </m3e-button>
    </div>

    <div class="manual-model"><label class="sr-only" for="manual-model-id">手动添加模型 ID</label><input id="manual-model-id" v-model="manualModel" class="field" placeholder="手动输入模型 ID" @keydown.enter.prevent="addManualModel" /><button type="button" class="button" :disabled="!manualModel.trim()" @click="addManualModel">添加模型</button></div>

    <!-- 已添加模型列表。 -->
    <m3e-list class="provider-models__list">
      <m3e-list-item v-for="model in props.models" :key="model.id">
        {{ model.name }}
        <span slot="supporting-text">{{ model.capabilities.join(' · ') }}</span>
        <m3e-icon-button slot="trailing" type="button" aria-label="移除模型" title="移除模型" @click="removeModel(model.id)">
          <HugeiconsIcon :icon="Delete01Icon" :stroke-width="ICON_STROKE_WIDTH" />
        </m3e-icon-button>
      </m3e-list-item>
      <m3e-divider v-if="props.models.length"></m3e-divider>
      <p v-if="!props.models.length" class="provider-models__empty">尚未添加模型</p>
    </m3e-list>
  </section>

  <!-- 远程模型选择弹窗。 -->
  <m3e-dialog ref="chooserDialog" class="provider-models__dialog">
    <m3e-heading slot="header" variant="headline" size="small" level="2">选择模型</m3e-heading>
    <m3e-action-list class="provider-models__available" aria-label="可添加模型">
      <m3e-list-action v-for="model in availableModels" :key="model.id" @click="toggleModel(model)">
        {{ model.name }}
        <span slot="supporting-text">{{ model.capabilities.join(' · ') }}</span>
        <HugeiconsIcon slot="trailing" :icon="props.models.some(item => item.id === model.id) ? Tick01Icon : Add01Icon" :stroke-width="ICON_STROKE_WIDTH" />
      </m3e-list-action>
    </m3e-action-list>
    <div slot="actions"><m3e-button type="button" @click="chooserDialog.hide()">关闭</m3e-button></div>
  </m3e-dialog>

</template>

<style scoped lang="scss">
/* --- 模型管理面板：垂直排列标题和列表 --- */
.provider-models { display: flex; flex-direction: column; gap: 16px; }
.manual-model { display: flex; align-items: center; gap: 8px; }
.manual-model .field { min-width: 0; flex: 1; font-size: 12px; }
.manual-model .button { flex-shrink: 0; }

/* --- 标题行：左侧计数，右侧获取按钮 --- */
.provider-models__heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.provider-models__heading m3e-heading { display: flex; flex-direction: column; gap: 3px; }
.provider-models__heading span { color: var(--md-sys-color-outline); font-size: 13px; }

/* --- 模型卡片列表 --- */
.provider-models__list {
  display: flex;
  flex-direction: column;
}

/* --- 空状态占位 --- */
.provider-models__empty { margin: 0; padding: 24px; color: var(--md-sys-color-outline); text-align: center; }

/* --- 选择弹窗候选列表 --- */
.provider-models__available { display: flex; width: min(480px, 72vw); max-width: 100%; overflow: hidden; flex-direction: column; gap: 6px; padding: 4px; }
.provider-models__available m3e-list-action { --m3e-list-item-container-color: var(--md-sys-color-surface-container-high); width: 100%; }

/* --- 窄屏适配：标题行纵向堆叠 --- */
@media (max-width: 560px) {
  .provider-models__heading { align-items: stretch; flex-direction: column; }
}
</style>
