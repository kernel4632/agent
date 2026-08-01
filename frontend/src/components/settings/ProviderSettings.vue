<!--
供应商配置：左侧选择服务，右侧编辑开关、地址、密钥、模型和自定义参数。
模型发现与设置使用独立弹窗；全部修改进入 Settings 草稿而非直接保存。
调用示例：<ProviderConfig :config="draft" />。
-->
<script setup>
import { computed, ref, watch } from 'vue'                           // 引入提供商选择和弹窗状态
import { Settings } from '../../commands/settings.js'                // 引入提供商与模型指令
import { t } from '../../i18n.js'                                    // 引入响应式界面翻译
import TextField from '../shared/TextField.vue'                       // 引入 M3E 标准文本字段

const props = defineProps({ config: { type: Object, required: true } }) // 当前完整设置草稿
const selectedName = ref('')                                        // 当前右侧提供商
const modelDialogOpen = ref(false)                                  // 控制远程模型选择窗
const modelsLoading = ref(false)                                    // 表示模型发现请求正在反馈
const modelSettingsName = ref('')                                   // 控制模型设置窗
const renameDraft = ref('')                                         // 保存尚未提交的提供商名称

const providerNames = computed(() => Object.keys(props.config.providers || {})) // 左侧提供商目录
const provider = computed(() => props.config.providers?.[selectedName.value] || null) // 当前详情
const candidates = ref([])                                             // Server 返回的真实未添加模型候选
const currentModelSettings = computed(() => provider.value?.modelSettings?.[modelSettingsName.value] || {}) // 当前模型设置

watch(providerNames, (names) => {
  if (!names.includes(selectedName.value)) selectedName.value = names[0] || '' // 新增删除后保持有效选择
}, { immediate: true })
watch(selectedName, (name) => { renameDraft.value = name })           // 切换提供商时同步重命名草稿


// --- 新增并选择提供商 ---
function addProvider() {
  selectedName.value = Settings.addProvider()                         // 指令返回新身份供详情打开
}


// --- 保存提供商名称 ---
function saveName() {
  const result = Settings.renameProvider(selectedName.value, renameDraft.value) // 校验并重建配置键名
  if (result) selectedName.value = result                             // 保持重命名后详情打开
  else renameDraft.value = selectedName.value                         // 冲突时恢复当前名称
}


// --- 删除当前提供商 ---
function removeProvider() {
  if (!selectedName.value) return                                    // 无选择无需动作
  Settings.removeProvider(selectedName.value)                         // 从草稿删除当前提供商
}


// --- 添加发现模型 ---
function addDiscoveredModel(modelName) {
  Settings.addModel(selectedName.value, modelName)                    // 模型和默认能力一起进入草稿
}


// --- 打开模型设置 ---
function openModelSettings(modelName) {
  modelSettingsName.value = modelName                                 // 弹窗定位目标模型
}


// --- 获取并展示模型目录 ---
async function openModelPicker() {
  modelDialogOpen.value = true                                        // 先打开弹窗展示明确加载反馈
  modelsLoading.value = true                                          // 按钮和弹窗共享请求状态
  candidates.value = await Settings.fetchModels(selectedName.value)     // 读取供应商真实模型目录
  modelsLoading.value = false                                         // 候选目录就绪后显示可选项
}
</script>

<template>
  <section class="provider-settings">
    <aside class="provider-list">
      <header><div><h2>{{ t('providers') }}</h2><span>{{ providerNames.length }}</span></div></header>
      <div class="provider-list__items">
        <m3e-card v-for="name in providerNames" :key="name" actionable :variant="selectedName === name ? 'filled' : 'outlined'" :class="{ 'is-active': selectedName === name }" @click="selectedName = name">
          <div class="provider-list-item"><m3e-avatar>{{ name.slice(0, 1).toUpperCase() }}</m3e-avatar><strong>{{ name }}</strong><i :class="{ 'is-on': config.providers[name].enabled }"></i></div>
        </m3e-card>
      </div>
      <m3e-button class="provider-list__add" @click="addProvider"><m3e-icon slot="icon" name="add"></m3e-icon>{{ t('addProvider') }}</m3e-button>
    </aside>

    <div v-if="provider" class="provider-detail">
      <div class="setting-row provider-identity">
        <TextField v-model="renameDraft" :label="t('providerName')" @keydown.enter="saveName" @blur="saveName" />
        <label class="switch-field"><span><strong>{{ t('enableProvider') }}</strong><small>{{ t('enableProviderDescription') }}</small></span><m3e-switch :checked="provider.enabled" @change="Settings.updateProvider(selectedName, 'enabled', $event.target.checked)"></m3e-switch></label>
      </div>

      <TextField :label="t('apiAddress')" :model-value="provider.baseURL" placeholder="https://api.example.com/v1" @update:model-value="Settings.updateProvider(selectedName, 'baseURL', $event)" />
      <TextField label="API Key" type="password" :model-value="provider.apiKey" placeholder="sk-..." @update:model-value="Settings.updateProvider(selectedName, 'apiKey', $event)" />

      <section class="provider-models">
        <header><div><h3>{{ t('modelList') }}</h3><p>{{ t('modelListDescription') }}</p></div><m3e-button :disabled="modelsLoading" @click="openModelPicker"><m3e-icon slot="icon" name="download"></m3e-icon>{{ t('fetchModels') }}</m3e-button></header>
        <div class="provider-model-list">
          <m3e-card v-for="modelName in provider.models" :key="modelName">
            <div class="provider-model-row"><m3e-avatar class="model-symbol">M</m3e-avatar>
              <div><strong>{{ modelName }}</strong><small><span v-if="provider.modelSettings?.[modelName]?.reasoning">{{ t('reasoningCapability') }}</span><span v-if="provider.modelSettings?.[modelName]?.tools">{{ t('toolCapability') }}</span><span>{{ (provider.modelSettings?.[modelName]?.context || 128000).toLocaleString() }} ctx</span></small></div>
              <m3e-icon-button class="icon-command" :aria-label="t('modelSettings')" :title="t('modelSettings')" @click="openModelSettings(modelName)"><m3e-icon name="tune"></m3e-icon></m3e-icon-button>
              <m3e-icon-button class="icon-command" :aria-label="t('removeModel')" :title="t('removeModel')" @click="Settings.removeModel(selectedName, modelName)"><m3e-icon name="close"></m3e-icon></m3e-icon-button>
            </div>
          </m3e-card>
          <div v-if="!provider.models.length" class="empty-state compact">{{ t('noModels') }}</div>
        </div>
      </section>

      <section class="custom-provider-settings">
        <h3>{{ t('customConfig') }}</h3>
        <div class="setting-grid">
          <TextField :label="t('requestTimeout')" type="number" :model-value="String(provider.timeout)" @update:model-value="Settings.updateProvider(selectedName, 'timeout', Number($event))" />
          <TextField :label="t('customHeaders')" :model-value="provider.headers" @update:model-value="Settings.updateProvider(selectedName, 'headers', $event)" />
        </div>
      </section>

      <m3e-button class="text-danger" @click="removeProvider"><m3e-icon slot="icon" name="delete"></m3e-icon>{{ t('deleteProvider') }}</m3e-button>
    </div>

    <m3e-dialog class="model-dialog" :open="modelDialogOpen" @closed="modelDialogOpen = false">
        <span slot="header">{{ t('selectModel') }}</span>
        <span>{{ t('availableModels', { provider: selectedName }) }}</span>
        <div v-if="modelsLoading" class="model-picker-loading"><m3e-circular-progress-indicator></m3e-circular-progress-indicator></div>
        <div class="model-picker">
          <template v-if="!modelsLoading"><m3e-card v-for="modelName in candidates" :key="modelName" actionable @click="addDiscoveredModel(modelName)"><div class="model-picker-row"><m3e-avatar>M</m3e-avatar><strong>{{ modelName }}</strong><m3e-icon name="add"></m3e-icon></div></m3e-card></template>
          <div v-if="!modelsLoading && !candidates.length" class="empty-state compact">{{ t('allModelsAdded') }}</div>
        </div>
        <div slot="actions" end><m3e-button variant="filled"><m3e-dialog-action @click="modelDialogOpen = false">{{ t('done') }}</m3e-dialog-action></m3e-button></div>
    </m3e-dialog>

    <m3e-dialog class="model-settings-dialog" :open="Boolean(modelSettingsName)" @closed="modelSettingsName = ''">
        <span slot="header">{{ modelSettingsName }}</span>
        <span>{{ t('modelLimits') }}</span>
        <div class="setting-grid">
          <TextField :label="t('contextLength')" type="number" :model-value="String(currentModelSettings.context || 128000)" @update:model-value="Settings.updateModel(selectedName, modelSettingsName, { context: Number($event) })" />
          <TextField :label="t('maxOutput')" type="number" :model-value="String(currentModelSettings.maxOutputTokens || 16000)" @update:model-value="Settings.updateModel(selectedName, modelSettingsName, { maxOutputTokens: Number($event) })" />
          <label class="switch-field"><span><strong>{{ t('reasoningFeature') }}</strong><small>{{ t('reasoningDescription') }}</small></span><m3e-switch :checked="currentModelSettings.reasoning === true" @change="Settings.updateModel(selectedName, modelSettingsName, { reasoning: $event.target.checked })"></m3e-switch></label>
          <label class="switch-field"><span><strong>{{ t('toolFeature') }}</strong><small>{{ t('toolDescription') }}</small></span><m3e-switch :checked="currentModelSettings.tools === true" @change="Settings.updateModel(selectedName, modelSettingsName, { tools: $event.target.checked })"></m3e-switch></label>
        </div>
        <div slot="actions" end><m3e-button variant="filled"><m3e-dialog-action @click="modelSettingsName = ''">{{ t('done') }}</m3e-dialog-action></m3e-button></div>
    </m3e-dialog>
  </section>
</template>

<style lang="scss" src="../../styles/components/ProviderConfig.scss"></style>
