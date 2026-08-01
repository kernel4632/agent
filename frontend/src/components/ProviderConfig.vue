<!--
供应商配置：左侧选择服务，右侧编辑开关、地址、密钥、模型和自定义参数。
模型发现与设置使用独立弹窗；全部修改进入 Settings 草稿而非直接保存。
调用示例：<ProviderConfig :config="draft" />。
-->
<script setup>
import { computed, ref, watch } from 'vue'                           // 引入提供商选择和弹窗状态
import { Settings } from '../commands/settings.js'                   // 引入提供商与模型指令
import { t } from '../i18n.js'                                       // 引入响应式界面翻译

const props = defineProps({ config: { type: Object, required: true } }) // 当前完整设置草稿
const selectedName = ref('')                                        // 当前右侧提供商
const modelDialogOpen = ref(false)                                  // 控制远程模型选择窗
const modelsLoading = ref(false)                                    // 表示模型发现请求正在反馈
const modelSettingsName = ref('')                                   // 控制模型设置窗
const renameDraft = ref('')                                         // 保存尚未提交的提供商名称

const providerNames = computed(() => Object.keys(props.config.providers || {})) // 左侧提供商目录
const provider = computed(() => props.config.providers?.[selectedName.value] || null) // 当前详情
const candidates = computed(() => Settings.fetchModels(selectedName.value)) // 本地模型发现候选
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
  await new Promise((resolve) => setTimeout(resolve, 650))             // TODO(API): 替换为真实模型发现请求
  modelsLoading.value = false                                         // 候选目录就绪后显示可选项
}
</script>

<template>
  <section class="provider-settings">
    <aside class="provider-list">
      <header><div><h2>{{ t('providers') }}</h2><span>{{ providerNames.length }}</span></div></header>
      <div class="provider-list__items">
        <mdui-card v-for="name in providerNames" :key="name" clickable variant="filled" :class="{ 'is-active': selectedName === name }" @click="selectedName = name">
          <mdui-avatar>{{ name.slice(0, 1).toUpperCase() }}</mdui-avatar><strong>{{ name }}</strong><i :class="{ 'is-on': config.providers[name].enabled }"></i>
        </mdui-card>
      </div>
      <mdui-button class="provider-list__add" variant="tonal" full-width @click="addProvider"><mdui-icon-add slot="icon"></mdui-icon-add>{{ t('addProvider') }}</mdui-button>
    </aside>

    <div v-if="provider" class="provider-detail">
      <div class="setting-row provider-identity">
        <mdui-text-field variant="outlined" :value="renameDraft" :label="t('providerName')" @input="renameDraft = $event.target.value" @keydown.enter="saveName" @blur="saveName"></mdui-text-field>
        <label class="switch-field"><span><strong>{{ t('enableProvider') }}</strong><small>{{ t('enableProviderDescription') }}</small></span><mdui-switch :checked="provider.enabled" @change="Settings.updateProvider(selectedName, 'enabled', $event.target.checked)"></mdui-switch></label>
      </div>

      <mdui-text-field variant="outlined" :label="t('apiAddress')" :value="provider.baseURL" placeholder="https://api.example.com/v1" @input="Settings.updateProvider(selectedName, 'baseURL', $event.target.value)"></mdui-text-field>
      <mdui-text-field variant="outlined" label="API Key" type="password" toggle-password :value="provider.apiKey" placeholder="sk-..." @input="Settings.updateProvider(selectedName, 'apiKey', $event.target.value)"></mdui-text-field>

      <section class="provider-models">
        <header><div><h3>{{ t('modelList') }}</h3><p>{{ t('modelListDescription') }}</p></div><mdui-button variant="tonal" :loading="modelsLoading" @click="openModelPicker"><mdui-icon-download slot="icon"></mdui-icon-download>{{ t('fetchModels') }}</mdui-button></header>
        <div class="provider-model-list">
          <mdui-card v-for="modelName in provider.models" :key="modelName" variant="filled">
            <mdui-avatar class="model-symbol">M</mdui-avatar>
            <div><strong>{{ modelName }}</strong><small><span v-if="provider.modelSettings?.[modelName]?.reasoning">{{ t('reasoningCapability') }}</span><span v-if="provider.modelSettings?.[modelName]?.tools">{{ t('toolCapability') }}</span><span>{{ (provider.modelSettings?.[modelName]?.context || 128000).toLocaleString() }} ctx</span></small></div>
            <mdui-button-icon class="icon-command" :aria-label="t('modelSettings')" :title="t('modelSettings')" @click="openModelSettings(modelName)"><mdui-icon-tune></mdui-icon-tune></mdui-button-icon>
            <mdui-button-icon class="icon-command" :aria-label="t('removeModel')" :title="t('removeModel')" @click="Settings.removeModel(selectedName, modelName)"><mdui-icon-close></mdui-icon-close></mdui-button-icon>
          </mdui-card>
          <div v-if="!provider.models.length" class="empty-state compact">{{ t('noModels') }}</div>
        </div>
      </section>

      <section class="custom-provider-settings">
        <h3>{{ t('customConfig') }}</h3>
        <div class="setting-grid">
          <mdui-text-field variant="outlined" :label="t('requestTimeout')" type="number" :value="provider.timeout" @input="Settings.updateProvider(selectedName, 'timeout', Number($event.target.value))"></mdui-text-field>
          <mdui-text-field variant="outlined" :label="t('customHeaders')" :value="provider.headers" @input="Settings.updateProvider(selectedName, 'headers', $event.target.value)"></mdui-text-field>
        </div>
      </section>

      <mdui-button class="text-danger" variant="text" @click="removeProvider"><mdui-icon-delete slot="icon"></mdui-icon-delete>{{ t('deleteProvider') }}</mdui-button>
    </div>

    <mdui-dialog class="model-dialog" :open="modelDialogOpen" close-on-overlay-click @closed="modelDialogOpen = false">
        <span slot="headline">{{ t('selectModel') }}</span>
        <span slot="description">{{ t('availableModels', { provider: selectedName }) }}</span>
        <div v-if="modelsLoading" class="model-picker-loading"><mdui-circular-progress></mdui-circular-progress></div>
        <div class="model-picker">
          <template v-if="!modelsLoading"><mdui-card v-for="modelName in candidates" :key="modelName" clickable variant="filled" @click="addDiscoveredModel(modelName)"><mdui-avatar>M</mdui-avatar><strong>{{ modelName }}</strong><mdui-icon-add></mdui-icon-add></mdui-card></template>
          <div v-if="!modelsLoading && !candidates.length" class="empty-state compact">{{ t('allModelsAdded') }}</div>
        </div>
        <mdui-button slot="action" variant="filled" @click="modelDialogOpen = false">{{ t('done') }}</mdui-button>
    </mdui-dialog>

    <mdui-dialog class="model-settings-dialog" :open="Boolean(modelSettingsName)" close-on-overlay-click @closed="modelSettingsName = ''">
        <span slot="headline">{{ modelSettingsName }}</span>
        <span slot="description">{{ t('modelLimits') }}</span>
        <div class="setting-grid">
          <mdui-text-field variant="outlined" :label="t('contextLength')" type="number" :value="currentModelSettings.context || 128000" @input="Settings.updateModel(selectedName, modelSettingsName, { context: Number($event.target.value) })"></mdui-text-field>
          <mdui-text-field variant="outlined" :label="t('maxOutput')" type="number" :value="currentModelSettings.output || 16000" @input="Settings.updateModel(selectedName, modelSettingsName, { output: Number($event.target.value) })"></mdui-text-field>
          <label class="switch-field"><span><strong>{{ t('reasoningFeature') }}</strong><small>{{ t('reasoningDescription') }}</small></span><mdui-switch :checked="currentModelSettings.reasoning === true" @change="Settings.updateModel(selectedName, modelSettingsName, { reasoning: $event.target.checked })"></mdui-switch></label>
          <label class="switch-field"><span><strong>{{ t('toolFeature') }}</strong><small>{{ t('toolDescription') }}</small></span><mdui-switch :checked="currentModelSettings.tools === true" @change="Settings.updateModel(selectedName, modelSettingsName, { tools: $event.target.checked })"></mdui-switch></label>
        </div>
        <mdui-button slot="action" variant="filled" @click="modelSettingsName = ''">{{ t('done') }}</mdui-button>
    </mdui-dialog>
  </section>
</template>

<style lang="scss" src="../styles/components/ProviderConfig.scss"></style>
