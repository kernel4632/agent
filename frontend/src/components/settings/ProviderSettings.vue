<!--
供应商配置组合页：协调供应商列表选择、添加新供应商和单项字段更新。
设计思想：左右分栏，左侧 ProviderList 管理供应商集合，右侧 ProviderEditor 编辑选中项。
供应商数组通过 v-model:providers 双向绑定，由设置页统一管理持久化时机。
调用示例：<ProviderSettings v-model:providers="settingsDraft.providers" />。
-->
<script setup>
import { computed, ref, watch } from 'vue'       // 引入响应式状态、计算和监听
import ProviderEditor from './ProviderEditor.vue' // 引入右侧供应商编辑面板
import ProviderList from './ProviderList.vue'     // 引入左侧供应商列表面板

const props = defineProps({ providers: { type: Array, required: true } }) // 接收供应商数组（双向绑定）
const emit = defineEmits(['update:providers'])    // 输出变更后的供应商数组
const selectedProviderID = ref(props.providers[0]?.id ?? '')  // 当前选中供应商的唯一身份

const selectedProvider = computed(() => props.providers.find(provider => provider.id === selectedProviderID.value) ?? null) // 选中供应商的完整对象


// --- 添加可立即编辑的新供应商 ---
function addProvider() {
  const providerNumber = props.providers.length + 1       // 用现有数量 +1 生成可读的默认名称序号
  const newProvider = {
    id: `provider-${crypto.randomUUID()}`,                // 全局唯一身份，避免同名供应商冲突
    name: `新供应商 ${providerNumber}`,                    // 默认显示名，用户可在编辑器中修改
    enabled: true,                                        // 新建默认启用，立即可被 Session 选择
    apiType: 'openai-compatible',                         // 当前所有供应商使用 OpenAI 兼容协议
    apiUrl: '',                                           // 等待用户填写 API 请求地址
    apiKey: '',                                           // 等待用户填写认证密钥
    models: [],                                           // 空模型列表，用户通过获取或手动添加
  }

  emit('update:providers', [...props.providers, newProvider]) // 新供应商追加到数组末尾触发响应式更新
  selectedProviderID.value = newProvider.id                   // 添加后立即选中新项进入编辑状态
}


// --- 用编辑后的完整对象替换当前供应商 ---
function updateProvider(updatedProvider) {
  emit('update:providers', props.providers.map(provider => provider.id === updatedProvider.id ? updatedProvider : provider)) // 保持列表顺序不变，仅替换匹配项
}


// --- 供应商被删除后回退选择 ---
watch(() => props.providers, providers => {
  if (providers.some(provider => provider.id === selectedProviderID.value)) return // 当前选择仍存在，无需跳转
  selectedProviderID.value = providers[0]?.id ?? ''                              // 删除或重载后回到首项
})
</script>

<template>
  <section class="provider-settings">
    <!-- 顶部标题栏：标题计数和添加按钮。 -->
    <header class="provider-settings__header">
      <div>
        <m3e-heading variant="headline" size="small" level="2">供应商配置</m3e-heading>
        <span>{{ props.providers.length }} 个供应商</span>
      </div>
      <m3e-button type="button" variant="filled" @click="addProvider">
        <m3e-icon slot="icon" name="add" filled="1"></m3e-icon>
        添加供应商
      </m3e-button>
    </header>

    <!-- 主体双栏：左侧列表，右侧编辑器。 -->
    <div class="provider-settings__body">
      <ProviderList :providers="props.providers" :selected-id="selectedProviderID" @select="selectedProviderID = $event" />
      <div class="provider-settings__editor">
        <ProviderEditor v-if="selectedProvider" :provider="selectedProvider" @update:provider="updateProvider" />
        <div v-else class="provider-settings__empty">
          <span>添加一个供应商以开始配置</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
/* --- 供应商配置主容器：垂直排列标题和主体 --- */
.provider-settings {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

/* --- 顶部标题栏：左侧标题计数，右侧添加按钮 --- */
.provider-settings__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  gap: 20px;
  padding: 26px 32px 22px;
  border-bottom: 1px solid #242424;
}

.provider-settings__header > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.provider-settings__header span { color: #7f7f7f; font-size: 13px; }

/* --- 主体双栏：左侧列表 + 右侧编辑器 --- */
.provider-settings__body {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
}

/* --- 编辑器区域：填充剩余空间并垂直滚动 --- */
.provider-settings__editor {
  min-width: 0;
  overflow-y: auto;
  flex: 1 1 auto;
  @include scrollbar-dark;
}

/* --- 空状态居中提示 --- */
.provider-settings__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 420px;
  color: #777777;
}

/* --- 窄屏适配：纵向堆叠 --- */
@media (max-width: 680px) {
  .provider-settings__header { align-items: flex-start; padding: 20px 16px; }
  .provider-settings__body { flex-direction: column; }
  .provider-settings__editor { overflow: visible; }
}
</style>
