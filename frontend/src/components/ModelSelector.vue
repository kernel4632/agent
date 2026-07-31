<!--
聊天模型选择器：聚合所有提供商模型，并通过 Material 下拉菜单即时切换当前模型。
组件只发出 provider/model 选择，Chat 视图负责执行配置指令并反馈结果。
调用示例：<ModelSelector :config="config.current" @select="selectModel" />。
-->
<script setup>
import { computed, ref } from 'vue'                  // 引入当前模型派生和下拉引用能力

const props = defineProps({                          // 声明脱敏配置数据
  config: { type: Object, default: null },           // 包含当前选择和全部提供商模型
  disabled: { type: Boolean, default: false },       // 运行或保存状态可锁定切换
})

const emit = defineEmits(['select'])                  // 将用户选择交回 Chat 视图
const dropdownElement = ref(null)                     // 保存下拉组件用于选择后立即关闭
const providerEntries = computed(() => Object.entries(props.config?.providers ?? {})) // 按提供商分组模型
const hasModels = computed(() => providerEntries.value.some(([, provider]) => provider.models?.length)) // 判断是否可选择
const currentLabel = computed(() => props.config?.activeModel || '选择模型') // 输入器底栏反馈当前模型


// --- 选择一个提供商模型 ---
function selectModel(providerName, modelName) {
  emit('select', { providerName, modelName })         // 发出完整模型身份避免同名模型歧义
  dropdownElement.value.open = false                  // 选择完成后释放输入区域视线
}
</script>

<template>
  <mdui-dropdown ref="dropdownElement" class="model-selector" placement="top-start" trigger="click">
    <mdui-button slot="trigger" class="model-selector__trigger" variant="text" :disabled="disabled || !hasModels">
      <span>{{ currentLabel }}</span>
      <mdui-icon-expand-more slot="end-icon"></mdui-icon-expand-more>
    </mdui-button>
    <mdui-menu class="model-selector__menu">
      <template v-for="([providerName, provider]) in providerEntries" :key="providerName">
        <div v-if="provider.models?.length" class="model-selector__provider">{{ providerName }}</div>
        <mdui-menu-item v-for="modelName in provider.models || []" :key="`${providerName}:${modelName}`" @click="selectModel(providerName, modelName)">
          <mdui-icon-check v-if="config.activeProvider === providerName && config.activeModel === modelName" slot="icon"></mdui-icon-check>
          <span v-else slot="icon" class="model-selector__dot"></span>
          {{ modelName }}
        </mdui-menu-item>
      </template>
    </mdui-menu>
  </mdui-dropdown>
</template>
