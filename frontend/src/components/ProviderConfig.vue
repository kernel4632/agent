<!--
提供商管理组件：以主从布局管理多个 OpenAI-compatible 服务及其模型清单。
新增、重命名、删除和字段编辑都只修改 Settings 草稿，保存后才写入 Server。
调用示例：<ProviderConfig v-model="draft" />。
-->
<script setup>
import { computed, ref, watch } from 'vue'            // 引入当前提供商、输入草稿和列表同步能力

const props = defineProps({                          // 声明设置页完整编辑副本
  modelValue: { type: Object, required: true },      // 包含 providers 和当前模型选择
})

const emit = defineEmits(['update:modelValue'])      // 将完整配置副本交回设置页
const selectedProvider = ref('')                     // 当前右侧正在编辑的提供商键名
const newModelName = ref('')                         // 尚未加入列表的模型名称
const providerError = ref('')                        // 重命名冲突等就地反馈
const providerNames = computed(() => Object.keys(props.modelValue.providers ?? {})) // 派生左侧提供商列表
const currentProvider = computed(() => props.modelValue.providers?.[selectedProvider.value] ?? null) // 派生当前详情


// --- 保持提供商选择有效 ---
watch(providerNames, (names) => {
  if (!names.includes(selectedProvider.value)) selectedProvider.value = names[0] ?? '' // 删除或首次加载后选择首项
}, { immediate: true })


// --- 替换提供商集合 ---
function updateProviders(providers, activeChanges = {}) {
  emit('update:modelValue', { ...props.modelValue, ...activeChanges, providers }) // 显式返回完整新配置
}


// --- 新增提供商 ---
function addProvider() {
  let index = providerNames.value.length + 1         // 从当前数量生成易理解默认名称
  let name = `provider-${index}`                     // 首个候选提供商键名
  while (props.modelValue.providers?.[name]) name = `provider-${++index}` // 避免覆盖已有配置
  const providers = { ...props.modelValue.providers, [name]: { apiKey: '', baseURL: '', models: [] } } // 创建完整服务结构
  updateProviders(providers)                         // 将新项写入设置草稿
  selectedProvider.value = name                     // 立即打开新项供用户编辑
  providerError.value = ''                          // 清除旧冲突反馈
}


// --- 重命名当前提供商 ---
function renameProvider(rawName) {
  const newName = rawName.trim()                     // 提供商键名不保留首尾空白
  const oldName = selectedProvider.value             // 保存重命名前身份
  if (!newName || newName === oldName) return        // 空名称和未变化无需修改
  if (props.modelValue.providers[newName]) {         // 防止覆盖其他提供商及密钥
    providerError.value = '该提供商名称已存在'
    return
  }

  const providers = {}                               // 按原顺序重建键名映射
  for (const [name, provider] of Object.entries(props.modelValue.providers)) {
    providers[name === oldName ? newName : name] = provider // 只替换当前键名
  }
  const activeChanges = props.modelValue.activeProvider === oldName ? { activeProvider: newName } : {} // 同步当前模型归属
  updateProviders(providers, activeChanges)          // 返回重命名后的完整配置
  selectedProvider.value = newName                   // 保持右侧详情打开
  providerError.value = ''                          // 成功后清除冲突反馈
}


// --- 修改当前提供商字段 ---
function updateProvider(field, value) {
  const providers = {                                // 复制提供商集合和当前详情
    ...props.modelValue.providers,
    [selectedProvider.value]: { ...currentProvider.value, [field]: value },
  }
  updateProviders(providers)                         // 将字段变化写入设置草稿
}


// --- 删除当前提供商 ---
function removeProvider() {
  const removedName = selectedProvider.value         // 保存待删除身份供当前模型判断
  const providers = { ...props.modelValue.providers } // 复制集合避免修改父级对象
  delete providers[removedName]                      // 从完整提交集合中移除服务
  const nextName = Object.keys(providers)[0] ?? ''   // 选择剩余首项作为回退
  const nextModel = providers[nextName]?.models?.[0] ?? '' // 读取回退提供商首个模型
  const activeChanges = props.modelValue.activeProvider === removedName ? { activeProvider: nextName, activeModel: nextModel } : {} // 防止活动模型悬空
  updateProviders(providers, activeChanges)          // 返回删除后的完整配置
}


// --- 添加模型到当前提供商 ---
function addModel() {
  const modelName = newModelName.value.trim()        // 模型 ID 不保留首尾空白
  const models = currentProvider.value?.models ?? [] // 读取当前模型列表
  if (!modelName || models.includes(modelName)) return // 空值和重复项不修改配置
  updateProvider('models', [...models, modelName])    // 将新模型追加到当前服务
  newModelName.value = ''                            // 清空输入反馈添加完成
}


// --- 删除一个模型 ---
function removeModel(modelName) {
  const models = currentProvider.value.models.filter((item) => item !== modelName) // 生成剩余模型列表
  const isActive = props.modelValue.activeProvider === selectedProvider.value && props.modelValue.activeModel === modelName // 判断是否删除当前模型
  const activeChanges = isActive ? { activeModel: models[0] ?? '' } : {} // 活动模型回退到同提供商首项
  const providers = { ...props.modelValue.providers, [selectedProvider.value]: { ...currentProvider.value, models } } // 写入新列表
  updateProviders(providers, activeChanges)          // 返回模型删除后的完整配置
}


// --- 设为当前聊天模型 ---
function activateModel(modelName) {
  emit('update:modelValue', {                         // 设置页立即更新活动模型草稿
    ...props.modelValue,
    activeProvider: selectedProvider.value,
    activeModel: modelName,
  })
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
      <div v-if="!providerNames.length" class="provider-list__empty">添加第一个模型提供商</div>
    </aside>

    <div v-if="currentProvider" class="provider-detail">
      <header class="provider-detail__header">
        <div><span class="provider-list__avatar provider-list__avatar--large">{{ selectedProvider.slice(0, 1).toUpperCase() }}</span><div><h2>{{ selectedProvider }}</h2><p>OpenAI-compatible API</p></div></div>
        <mdui-button-icon aria-label="删除提供商" @click="removeProvider"><mdui-icon-delete></mdui-icon-delete></mdui-button-icon>
      </header>

      <div v-if="providerError" class="notice notice--error">{{ providerError }}</div>
      <div class="provider-fields">
        <mdui-text-field label="提供商 ID" variant="outlined" :disabled="currentProvider.apiKey === '[REDACTED]'" :value="selectedProvider" @change="renameProvider($event.target.value)"><mdui-icon-edit slot="icon"></mdui-icon-edit></mdui-text-field>
        <mdui-text-field label="API 地址" variant="outlined" :value="currentProvider.baseURL || ''" placeholder="https://api.example.com/v1" @input="updateProvider('baseURL', $event.target.value)"><mdui-icon-dns slot="icon"></mdui-icon-dns></mdui-text-field>
        <mdui-text-field class="provider-fields__wide" label="API Key" variant="outlined" type="password" :value="currentProvider.apiKey || ''" @input="updateProvider('apiKey', $event.target.value)"><mdui-icon-key slot="icon"></mdui-icon-key></mdui-text-field>
      </div>

      <section class="model-catalog">
        <header><div><h3>模型</h3><p>这些模型会出现在对话输入器的切换菜单中。</p></div><span>{{ currentProvider.models?.length || 0 }}</span></header>
        <div class="model-add">
          <mdui-text-field label="模型 ID" variant="outlined" :value="newModelName" @input="newModelName = $event.target.value" @keydown.enter="addModel"></mdui-text-field>
          <mdui-button variant="tonal" @click="addModel"><mdui-icon-add slot="icon"></mdui-icon-add>添加</mdui-button>
        </div>
        <div class="model-list">
          <button v-for="modelName in currentProvider.models || []" :key="modelName" type="button" :class="{ 'is-active': modelValue.activeProvider === selectedProvider && modelValue.activeModel === modelName }" @click="activateModel(modelName)">
            <span class="model-list__status"><mdui-icon-check v-if="modelValue.activeProvider === selectedProvider && modelValue.activeModel === modelName"></mdui-icon-check></span>
            <span><strong>{{ modelName }}</strong><small>{{ modelValue.activeProvider === selectedProvider && modelValue.activeModel === modelName ? '当前使用' : '点击设为当前模型' }}</small></span>
            <mdui-button-icon aria-label="移除模型" @click.stop="removeModel(modelName)"><mdui-icon-close></mdui-icon-close></mdui-button-icon>
          </button>
          <div v-if="!currentProvider.models?.length" class="model-list__empty">还没有模型，输入 API 使用的模型 ID 添加。</div>
        </div>
      </section>
    </div>
  </section>
</template>
