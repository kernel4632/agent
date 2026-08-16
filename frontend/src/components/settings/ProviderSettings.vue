<!--
供应商配置组合页：协调供应商列表选择和单项字段更新。
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
    <ProviderList :providers="props.providers" :selected-id="selectedProviderID" @select="selectedProviderID = $event" />
    <div class="provider-settings__editor">
      <ProviderEditor v-if="selectedProvider" :provider="selectedProvider" @update:provider="updateProvider" />
      <div v-else class="provider-settings__empty">
        <span>添加一个供应商以开始配置</span>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.provider-settings {
  display: flex;
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
  color: var(--md-sys-color-outline);
}

/* --- 窄屏适配：纵向堆叠 --- */
@media (max-width: 680px) {
  .provider-settings { flex-direction: column; }
  .provider-settings__editor { overflow: visible; }
}
</style>
