<!--
提供商管理组件：编辑显式协议、认证、请求选项和每个模型的生成限制。
全部字段只修改 Settings 草稿；连接测试单独使用 Server 已保存配置，避免临时密钥外传。
调用示例：<ProviderConfig v-model="draft" />。
-->
<script setup>
import { computed, ref } from 'vue'                    // 引入当前提供商和局部字段反馈
import { Settings } from '../commands/settings.js'    // 引入提供商、模型和连接测试指令
import { useConfigStore } from '../store.js'          // 引入已保存配置数据
import { watchProviderEditor } from '../watchers.js'   // 引入集中管理的提供商反馈监听

const props = defineProps({                           // 声明设置页完整编辑副本
  modelValue: { type: Object, required: true },       // 包含 providers 和当前模型选择
})

const emit = defineEmits(['update:modelValue', 'validity']) // 将配置草稿和校验状态交回设置页
const config = useConfigStore()                       // 只读取与草稿隔离的已保存配置
const selectedProvider = ref('')                      // 当前详情对应的提供商键名
const newModelName = ref('')                          // 尚未加入清单的模型 ID
const providerError = ref('')                         // 重命名冲突等提供商错误
const headersText = ref('{}')                         // 保留用户输入格式的请求头 JSON
const headersError = ref('')                          // 阻止无效 JSON 写入配置草稿
const testState = ref(null)                           // 保存结构化连接测试反馈
const isTesting = ref(false)                          // 防止重复连接测试
const providerNames = computed(() => Object.keys(props.modelValue.providers ?? {})) // 派生左侧提供商列表
const currentProvider = computed(() => props.modelValue.providers?.[selectedProvider.value] ?? null) // 派生当前提供商详情
const savedProvider = computed(() => config.config?.providers?.[selectedProvider.value] ?? null) // 查找同名已保存服务
const renameLocked = computed(() => savedProvider.value?.apiKey === '[REDACTED]' && (!currentProvider.value?.apiKey || currentProvider.value.apiKey === '[REDACTED]')) // 密钥仍脱敏时禁止改变保存身份


// --- 保持提供商选择有效 ---
watchProviderEditor(providerNames, selectedProvider, currentProvider, headersText, headersError, testState, emit) // 集中同步选择、请求头和保存校验


// --- 新增提供商 ---
function addProvider() {
  Settings.addProvider(props.modelValue, providerNames.value, emit, selectedProvider, providerError) // 将新增和反馈交给设置指令
}


// --- 重命名当前提供商 ---
function renameProvider(rawName) {
  Settings.renameProvider(props.modelValue, emit, selectedProvider, providerError, renameLocked.value, rawName) // 将校验和草稿修改交给设置指令
}


// --- 修改当前提供商字段 ---
function updateProvider(field, value) {
  Settings.updateProvider(props.modelValue, emit, selectedProvider.value, currentProvider.value, testState, field, value) // 将字段修改交给设置指令
}


// --- 修改缓存字段 ---
function updateCache(field, value) {
  Settings.updateCache(props.modelValue, emit, selectedProvider.value, currentProvider.value, testState, field, value) // 将缓存修改交给设置指令
}


// --- 校验并修改请求头 ---
function updateHeaders(rawText) {
  Settings.updateHeaders(props.modelValue, emit, selectedProvider.value, currentProvider.value, testState, headersText, headersError, rawText) // 将 JSON 校验和修改交给设置指令
}


// --- 删除当前提供商 ---
function removeProvider() {
  Settings.removeProvider(props.modelValue, emit, selectedProvider.value) // 将删除和活动模型回退交给设置指令
}


// --- 添加模型到当前提供商 ---
function addModel() {
  Settings.addModel(props.modelValue, emit, selectedProvider.value, currentProvider.value, testState, newModelName) // 将模型新增交给设置指令
}


// --- 删除一个模型 ---
function removeModel(modelName) {
  Settings.removeModel(props.modelValue, emit, selectedProvider.value, currentProvider.value, testState, modelName) // 将模型删除和设置清理交给设置指令
}


// --- 修改一个模型的生成限制 ---
function updateModelSetting(modelName, field, rawValue) {
  Settings.updateModelSetting(props.modelValue, emit, selectedProvider.value, currentProvider.value, testState, modelName, field, rawValue) // 将数字转换和草稿修改交给设置指令
}


// --- 设为当前聊天模型 ---
function activateModel(modelName) {
  Settings.activateModel(props.modelValue, emit, selectedProvider.value, modelName) // 将活动模型修改交给设置指令
}


// --- 测试已保存连接 ---
async function testSavedConnection() {
  await Settings.testSavedConnection(props.modelValue, selectedProvider.value, savedProvider.value, isTesting, testState) // 将认证测试和反馈交给设置指令
}


// --- 选择提供商详情 ---
function selectProvider(providerName) {
  Settings.selectProvider(selectedProvider, providerName) // 将详情选择交给设置指令
}


// --- 修改待添加模型名称 ---
function setNewModelName(event) {
  Settings.setNewModelName(newModelName, event.target.value) // 将模型输入交给设置指令
}
</script>

<template>
  <section class="provider-settings">
    <aside class="provider-list">
      <header>
        <div><h2>模型服务</h2><p>{{ providerNames.length }} 个提供商</p></div>
        <mdui-button-icon aria-label="添加提供商" @click="addProvider"><mdui-icon-add></mdui-icon-add></mdui-button-icon>
      </header>
      <button v-for="name in providerNames" :key="name" type="button" :class="{ 'is-active': selectedProvider === name }" @click="selectProvider(name)">
        <span class="provider-list__avatar">{{ name.slice(0, 1).toUpperCase() }}</span>
        <span><strong>{{ name }}</strong><small>{{ modelValue.providers[name].models?.length || 0 }} 个模型</small></span>
      </button>
      <div v-if="!providerNames.length" class="provider-list__empty">暂无模型服务</div>
    </aside>

    <div v-if="currentProvider" class="provider-detail">
      <header class="provider-detail__header">
        <div><span class="provider-list__avatar provider-list__avatar--large">{{ selectedProvider.slice(0, 1).toUpperCase() }}</span><div><h2>{{ selectedProvider }}</h2><p>{{ currentProvider.protocol }}</p></div></div>
        <div class="provider-detail__actions">
          <mdui-button variant="tonal" :disabled="!savedProvider || isTesting" @click="testSavedConnection">{{ isTesting ? '测试中' : '测试已保存连接' }}</mdui-button>
          <mdui-button-icon aria-label="删除提供商" @click="removeProvider"><mdui-icon-delete></mdui-icon-delete></mdui-button-icon>
        </div>
      </header>

      <div v-if="providerError" class="notice notice--error">{{ providerError }}</div>
      <div v-if="testState" class="provider-test" :class="testState.ok ? 'is-success' : 'is-error'" role="status">
        <strong>{{ testState.ok ? '连接成功' : '连接失败' }}</strong>
        <code>{{ testState.provider }}</code>
        <code v-if="testState.model">{{ testState.model }}</code>
        <span v-if="testState.latencyMs">{{ testState.latencyMs }} ms</span>
        <span v-if="testState.error">{{ testState.error }}</span>
      </div>

      <div class="provider-fields">
        <mdui-text-field label="提供商 ID" variant="outlined" :disabled="renameLocked" :value="selectedProvider" @change="renameProvider($event.target.value)"><mdui-icon-edit slot="icon"></mdui-icon-edit></mdui-text-field>
        <label class="provider-native-field"><span>协议</span><select :value="currentProvider.protocol || 'openai-compatible'" @change="updateProvider('protocol', $event.target.value)"><option value="openai-compatible">openai-compatible</option><option value="openai-responses">openai-responses</option></select></label>
        <mdui-text-field label="API 地址" variant="outlined" :value="currentProvider.baseURL || ''" @input="updateProvider('baseURL', $event.target.value)"><mdui-icon-dns slot="icon"></mdui-icon-dns></mdui-text-field>
        <mdui-text-field label="超时 (ms)" variant="outlined" type="number" min="1000" step="1000" :value="currentProvider.timeoutMs || 120000" @input="updateProvider('timeoutMs', Number($event.target.value))"></mdui-text-field>
        <mdui-text-field class="provider-fields__wide" label="API Key" variant="outlined" type="password" :value="currentProvider.apiKey || ''" @input="updateProvider('apiKey', $event.target.value)"><mdui-icon-key slot="icon"></mdui-icon-key></mdui-text-field>
        <label class="provider-json provider-fields__wide"><span>自定义请求头 (JSON)</span><textarea :value="headersText" spellcheck="false" aria-label="自定义请求头 JSON" @input="updateHeaders($event.target.value)"></textarea><small v-if="headersError" class="field-error">{{ headersError }}</small></label>
        <label class="provider-cache"><span><strong>缓存</strong><small>{{ currentProvider.cache?.mode || 'implicit' }}</small></span><mdui-switch :checked="currentProvider.cache?.enabled === true" @change="updateCache('enabled', $event.target.checked)"></mdui-switch></label>
        <label class="provider-native-field"><span>缓存模式</span><select :disabled="currentProvider.cache?.enabled !== true" :value="currentProvider.cache?.mode || 'implicit'" @change="updateCache('mode', $event.target.value)"><option value="implicit">implicit</option><option value="explicit">explicit</option></select></label>
      </div>

      <section class="model-catalog">
        <header><div><h3>模型</h3></div><span>{{ currentProvider.models?.length || 0 }}</span></header>
        <div class="model-add">
          <mdui-text-field label="模型 ID" variant="outlined" :value="newModelName" @input="setNewModelName" @keydown.enter="addModel"></mdui-text-field>
          <mdui-button variant="tonal" @click="addModel"><mdui-icon-add slot="icon"></mdui-icon-add>添加</mdui-button>
        </div>
        <div class="model-list">
          <article v-for="modelName in currentProvider.models || []" :key="modelName" class="model-entry" :class="{ 'is-active': modelValue.activeProvider === selectedProvider && modelValue.activeModel === modelName }">
            <header>
              <button type="button" @click="activateModel(modelName)"><span class="model-list__status"><mdui-icon-check v-if="modelValue.activeProvider === selectedProvider && modelValue.activeModel === modelName"></mdui-icon-check></span><strong>{{ modelName }}</strong></button>
              <mdui-button-icon aria-label="移除模型" @click="removeModel(modelName)"><mdui-icon-close></mdui-icon-close></mdui-button-icon>
            </header>
            <div class="model-entry__settings">
              <label><span>上下文</span><input type="number" min="1" step="1024" :value="currentProvider.modelSettings?.[modelName]?.context ?? ''" @input="updateModelSetting(modelName, 'context', $event.target.value)" /></label>
              <label><span>最大输出</span><input type="number" min="1" step="256" :value="currentProvider.modelSettings?.[modelName]?.maxOutputTokens ?? ''" @input="updateModelSetting(modelName, 'maxOutputTokens', $event.target.value)" /></label>
              <label><span>温度</span><input type="number" min="0" max="2" step="0.1" :value="currentProvider.modelSettings?.[modelName]?.temperature ?? ''" @input="updateModelSetting(modelName, 'temperature', $event.target.value)" /></label>
            </div>
          </article>
          <div v-if="!currentProvider.models?.length" class="model-list__empty">暂无模型</div>
        </div>
      </section>
    </div>
  </section>
</template>
