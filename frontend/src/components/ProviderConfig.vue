<!--
提供商管理组件：编辑显式协议、认证、请求选项和每个模型的生成限制。
全部字段只修改 Settings 草稿；连接测试单独使用 Server 已保存配置，避免临时密钥外传。
调用示例：<ProviderConfig v-model="draft" />。
-->
<script setup>
import { computed, ref, watch } from 'vue'             // 引入当前提供商和局部字段反馈
import { useConfigStore } from '../stores/config.js'  // 引入已保存连接测试指令

const props = defineProps({                           // 声明设置页完整编辑副本
  modelValue: { type: Object, required: true },       // 包含 providers 和当前模型选择
})

const emit = defineEmits(['update:modelValue', 'validity']) // 将配置草稿和校验状态交回设置页
const config = useConfigStore()                       // 读取与草稿隔离的已保存配置
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
watch(providerNames, (names) => {
  if (!names.includes(selectedProvider.value)) selectedProvider.value = names[0] ?? '' // 删除或首次加载后选择首项
}, { immediate: true })

watch(selectedProvider, () => {
  headersText.value = JSON.stringify(currentProvider.value?.headers ?? {}, null, 2) // 切换时读取该服务的请求头草稿
  headersError.value = ''                             // 不把上一服务的校验错误带入新详情
  testState.value = null                              // 测试反馈只属于触发时服务
}, { immediate: true })

watch(headersError, (error) => emit('validity', !error), { immediate: true }) // 阻止设置页保存当前无效 JSON


// --- 替换提供商集合 ---
function updateProviders(providers, activeChanges = {}) {
  emit('update:modelValue', { ...props.modelValue, ...activeChanges, providers }) // 显式返回完整新配置草稿
}


// --- 新增提供商 ---
function addProvider() {
  let index = providerNames.value.length + 1          // 从当前数量生成稳定默认名称
  let name = `provider-${index}`                      // 创建首个候选键名
  while (props.modelValue.providers?.[name]) name = `provider-${++index}` // 避免覆盖已有提供商
  const provider = {                                 // 使用 Server 当前规范创建完整草稿
    protocol: 'openai-compatible',                    // 通用端点作为保守默认协议
    baseURL: '',                                      // 新服务等待用户填写 API 地址
    apiKey: '',                                       // 新服务不继承其他认证
    headers: {},                                      // 自定义请求头从空对象开始
    timeoutMs: 120000,                                // 与 Server 默认两分钟一致
    cache: { enabled: false, mode: 'implicit' },      // 未明确开启前不添加缓存亲和键
    models: [],                                       // 模型由用户按真实 ID 添加
    modelSettings: {},                                // 每模型限制随模型一同维护
  }
  updateProviders({ ...props.modelValue.providers, [name]: provider }) // 将完整新项写入草稿
  selectedProvider.value = name                      // 立即打开新服务详情
  providerError.value = ''                           // 清除旧重命名反馈
}


// --- 重命名当前提供商 ---
function renameProvider(rawName) {
  const newName = rawName.trim()                      // 提供商身份不保留首尾空白
  const oldName = selectedProvider.value              // 保存重命名前键名
  if (!newName || newName === oldName) return         // 空名称和未变化无需修改
  if (renameLocked.value) return                      // 脱敏密钥只能在原名称下由 Server 保留
  if (props.modelValue.providers[newName]) {
    providerError.value = '该提供商名称已存在'        // 防止覆盖其他服务和认证
    return
  }

  const providers = {}                                // 按原顺序重建键名映射
  for (const [name, provider] of Object.entries(props.modelValue.providers)) {
    providers[name === oldName ? newName : name] = provider // 只替换当前服务身份
  }
  const activeChanges = props.modelValue.activeProvider === oldName ? { activeProvider: newName } : {} // 同步当前模型归属
  updateProviders(providers, activeChanges)           // 返回重命名后的完整草稿
  selectedProvider.value = newName                    // 保持详情打开
  providerError.value = ''                           // 成功后清除冲突反馈
}


// --- 修改当前提供商字段 ---
function updateProvider(field, value) {
  const providers = {                                // 复制集合和当前详情保持单向数据流
    ...props.modelValue.providers,
    [selectedProvider.value]: { ...currentProvider.value, [field]: value },
  }
  updateProviders(providers)                          // 将字段变化写入设置草稿
  testState.value = null                              // 草稿变化后旧测试反馈不再代表当前表单
}


// --- 修改缓存字段 ---
function updateCache(field, value) {
  updateProvider('cache', { ...currentProvider.value.cache, [field]: value }) // 保留缓存对象另一字段
}


// --- 校验并修改请求头 ---
function updateHeaders(rawText) {
  headersText.value = rawText                         // 始终保留用户正在编辑的原始 JSON
  try {
    const headers = JSON.parse(rawText || '{}')       // 将文本解析为 Server 需要的对象
    if (!headers || Array.isArray(headers) || typeof headers !== 'object') throw new Error('请求头必须是 JSON 对象') // 拒绝数组和标量
    if (Object.values(headers).some((value) => typeof value !== 'string')) throw new Error('请求头值必须是字符串') // HTTP 请求头保持字符串值
    headersError.value = ''                           // 有效对象清除旧错误
    updateProvider('headers', headers)                // 仅有效 JSON 进入可保存草稿
  } catch (error) {
    headersError.value = error.message                // 无效输入留在文本框供继续修正
  }
}


// --- 删除当前提供商 ---
function removeProvider() {
  const removedName = selectedProvider.value          // 保存待删除身份供活动模型判断
  const providers = { ...props.modelValue.providers } // 复制集合避免修改父级对象
  delete providers[removedName]                       // 从完整提交集合中移除服务
  const nextName = Object.keys(providers)[0] ?? ''    // 选择剩余首项作为回退
  const nextModel = providers[nextName]?.models?.[0] ?? '' // 读取回退服务首个模型
  const activeChanges = props.modelValue.activeProvider === removedName ? { activeProvider: nextName, activeModel: nextModel } : {} // 防止活动模型悬空
  updateProviders(providers, activeChanges)           // 返回删除后的完整草稿
}


// --- 添加模型到当前提供商 ---
function addModel() {
  const modelName = newModelName.value.trim()         // 模型 ID 不保留首尾空白
  const models = currentProvider.value?.models ?? []  // 读取当前模型清单
  if (!modelName || models.includes(modelName)) return // 空值和重复项不修改配置
  updateProvider('models', [...models, modelName])     // 将新模型追加到当前服务
  newModelName.value = ''                             // 清空输入反馈添加完成
}


// --- 删除一个模型 ---
function removeModel(modelName) {
  const models = currentProvider.value.models.filter((item) => item !== modelName) // 生成剩余模型清单
  const modelSettings = { ...currentProvider.value.modelSettings } // 同步清理已删除模型限制
  delete modelSettings[modelName]                     // 不保留游离模型配置
  const isActive = props.modelValue.activeProvider === selectedProvider.value && props.modelValue.activeModel === modelName // 判断是否删除当前模型
  const activeChanges = isActive ? { activeModel: models[0] ?? '' } : {} // 活动模型回退到同服务首项
  const providers = { ...props.modelValue.providers, [selectedProvider.value]: { ...currentProvider.value, models, modelSettings } } // 写入新清单
  updateProviders(providers, activeChanges)           // 返回模型删除后的完整草稿
}


// --- 修改一个模型的生成限制 ---
function updateModelSetting(modelName, field, rawValue) {
  const settings = { ...(currentProvider.value.modelSettings?.[modelName] ?? {}) } // 复制目标模型设置
  if (rawValue === '') delete settings[field]         // 空字段恢复 Server 默认值
  else settings[field] = Number(rawValue)             // 数字控件值转换为 JSON 数值
  const modelSettings = { ...currentProvider.value.modelSettings, [modelName]: settings } // 写回对应模型 ID
  updateProvider('modelSettings', modelSettings)      // 其他模型设置保持不变
}


// --- 设为当前聊天模型 ---
function activateModel(modelName) {
  emit('update:modelValue', {                         // 设置页只更新活动模型草稿
    ...props.modelValue,
    activeProvider: selectedProvider.value,
    activeModel: modelName,
  })
}


// --- 测试已保存连接 ---
async function testSavedConnection() {
  if (!savedProvider.value || isTesting.value) return // 新服务必须保存后才能由 Server 使用认证
  isTesting.value = true                              // 测试动作进入禁用状态
  testState.value = null                              // 清除旧反馈
  const activeSavedModel = props.modelValue.activeProvider === selectedProvider.value && savedProvider.value.models?.includes(props.modelValue.activeModel) // 判断草稿当前模型是否属于该已保存服务
  const savedModel = activeSavedModel ? props.modelValue.activeModel : savedProvider.value.models?.[0] // 优先测试同服务当前模型
  testState.value = await config.testConnection(selectedProvider.value, savedModel) // 用 Server 保存的密钥执行最小请求
  isTesting.value = false                             // 恢复可重复测试状态
}
</script>

<template>
  <section class="provider-settings">
    <aside class="provider-list">
      <header>
        <div><h2>模型服务</h2><p>{{ providerNames.length }} 个提供商</p></div>
        <mdui-button-icon aria-label="添加提供商" @click="addProvider"><mdui-icon-add></mdui-icon-add></mdui-button-icon>
      </header>
      <button v-for="name in providerNames" :key="name" type="button" :class="{ 'is-active': selectedProvider === name }" @click="selectedProvider = name">
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
          <mdui-text-field label="模型 ID" variant="outlined" :value="newModelName" @input="newModelName = $event.target.value" @keydown.enter="addModel"></mdui-text-field>
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
