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
</script>

<template>
  <section class="provider-settings">
    <aside class="provider-list">
      <header><div><h2>{{ t('providers') }}</h2><span>{{ providerNames.length }}</span></div></header>
      <div class="provider-list__items">
        <button v-for="name in providerNames" :key="name" type="button" :class="{ 'is-active': selectedName === name }" @click="selectedName = name">
          <span>{{ name.slice(0, 1).toUpperCase() }}</span><strong>{{ name }}</strong><i :class="{ 'is-on': config.providers[name].enabled }"></i>
        </button>
      </div>
      <button class="provider-list__add" type="button" @click="addProvider"><mdui-icon-add></mdui-icon-add>{{ t('addProvider') }}</button>
    </aside>

    <div v-if="provider" class="provider-detail">
      <div class="setting-row provider-identity">
        <label><span>{{ t('providerName') }}</span><input v-model="renameDraft" @keydown.enter="saveName" @blur="saveName" /></label>
        <label class="switch-field"><span><strong>{{ t('enableProvider') }}</strong><small>{{ t('enableProviderDescription') }}</small></span><mdui-switch :checked="provider.enabled" @change="Settings.updateProvider(selectedName, 'enabled', $event.target.checked)"></mdui-switch></label>
      </div>

      <label class="setting-field"><span>{{ t('apiAddress') }}</span><input :value="provider.baseURL" placeholder="https://api.example.com/v1" @input="Settings.updateProvider(selectedName, 'baseURL', $event.target.value)" /></label>
      <label class="setting-field"><span>API Key</span><input type="password" :value="provider.apiKey" placeholder="sk-..." @input="Settings.updateProvider(selectedName, 'apiKey', $event.target.value)" /></label>

      <section class="provider-models">
        <header><div><h3>{{ t('modelList') }}</h3><p>{{ t('modelListDescription') }}</p></div><button type="button" @click="modelDialogOpen = true"><mdui-icon-download></mdui-icon-download>{{ t('fetchModels') }}</button></header>
        <div class="provider-model-list">
          <article v-for="modelName in provider.models" :key="modelName">
            <span class="model-symbol">M</span>
            <div><strong>{{ modelName }}</strong><small><span v-if="provider.modelSettings?.[modelName]?.reasoning">{{ t('reasoningCapability') }}</span><span v-if="provider.modelSettings?.[modelName]?.tools">{{ t('toolCapability') }}</span><span>{{ (provider.modelSettings?.[modelName]?.context || 128000).toLocaleString() }} ctx</span></small></div>
            <button class="icon-command" type="button" :aria-label="t('modelSettings')" :title="t('modelSettings')" @click="openModelSettings(modelName)"><mdui-icon-tune></mdui-icon-tune></button>
            <button class="icon-command" type="button" :aria-label="t('removeModel')" :title="t('removeModel')" @click="Settings.removeModel(selectedName, modelName)"><mdui-icon-close></mdui-icon-close></button>
          </article>
          <div v-if="!provider.models.length" class="empty-state compact">{{ t('noModels') }}</div>
        </div>
      </section>

      <section class="custom-provider-settings">
        <h3>{{ t('customConfig') }}</h3>
        <div class="setting-grid">
          <label class="setting-field"><span>{{ t('requestTimeout') }}</span><input type="number" :value="provider.timeout" @input="Settings.updateProvider(selectedName, 'timeout', Number($event.target.value))" /></label>
          <label class="setting-field"><span>{{ t('customHeaders') }}</span><input :value="provider.headers" @input="Settings.updateProvider(selectedName, 'headers', $event.target.value)" /></label>
        </div>
      </section>

      <button class="text-danger" type="button" @click="removeProvider"><mdui-icon-delete></mdui-icon-delete>{{ t('deleteProvider') }}</button>
    </div>

    <div v-if="modelDialogOpen" class="modal-backdrop" @mousedown.self="modelDialogOpen = false">
      <section class="modal" role="dialog" aria-modal="true">
        <header><div><h2>{{ t('selectModel') }}</h2><p>{{ t('availableModels', { provider: selectedName }) }}</p></div><button class="icon-command" type="button" :aria-label="t('close')" @click="modelDialogOpen = false"><mdui-icon-close></mdui-icon-close></button></header>
        <div class="model-picker">
          <button v-for="modelName in candidates" :key="modelName" type="button" @click="addDiscoveredModel(modelName)"><span>M</span><strong>{{ modelName }}</strong><mdui-icon-add></mdui-icon-add></button>
          <div v-if="!candidates.length" class="empty-state compact">{{ t('allModelsAdded') }}</div>
        </div>
        <footer><button class="primary-button" type="button" @click="modelDialogOpen = false">{{ t('done') }}</button></footer>
      </section>
    </div>

    <div v-if="modelSettingsName" class="modal-backdrop" @mousedown.self="modelSettingsName = ''">
      <section class="modal" role="dialog" aria-modal="true">
        <header><div><h2>{{ modelSettingsName }}</h2><p>{{ t('modelLimits') }}</p></div><button class="icon-command" type="button" :aria-label="t('close')" @click="modelSettingsName = ''"><mdui-icon-close></mdui-icon-close></button></header>
        <div class="setting-grid">
          <label class="setting-field"><span>{{ t('contextLength') }}</span><input type="number" :value="currentModelSettings.context || 128000" @input="Settings.updateModel(selectedName, modelSettingsName, { context: Number($event.target.value) })" /></label>
          <label class="setting-field"><span>{{ t('maxOutput') }}</span><input type="number" :value="currentModelSettings.output || 16000" @input="Settings.updateModel(selectedName, modelSettingsName, { output: Number($event.target.value) })" /></label>
          <label class="switch-field"><span><strong>{{ t('reasoningFeature') }}</strong><small>{{ t('reasoningDescription') }}</small></span><mdui-switch :checked="currentModelSettings.reasoning === true" @change="Settings.updateModel(selectedName, modelSettingsName, { reasoning: $event.target.checked })"></mdui-switch></label>
          <label class="switch-field"><span><strong>{{ t('toolFeature') }}</strong><small>{{ t('toolDescription') }}</small></span><mdui-switch :checked="currentModelSettings.tools === true" @change="Settings.updateModel(selectedName, modelSettingsName, { tools: $event.target.checked })"></mdui-switch></label>
        </div>
        <footer><button class="primary-button" type="button" @click="modelSettingsName = ''">{{ t('done') }}</button></footer>
      </section>
    </div>
  </section>
</template>
