<!--
模型管理面板：展示已添加模型列表，提供远程获取和批量选择能力。
设计思想：组件只触发指令和渲染结果，模型去重和切换逻辑由 commands/settings.js 完成。
核心数据：models（当前供应商已添加的模型数组）、availableModels（远程获取后的候选列表）。
调用示例：<ProviderModels :provider="provider" :models="provider.models" @update:models="updateProvider({ models: $event })" />。
-->
<script setup>
import { ref } from 'vue'                              // 引入响应式状态管理
import { Settings } from '../../commands/settings.js'  // 引入模型发现和切换指令

const props = defineProps({
  provider: { type: Object, required: true },          // 接收当前供应商连接信息（用于远程获取）
  models: { type: Array, required: true },             // 接收当前已添加的模型数组
})
const emit = defineEmits(['update:models'])             // 输出变更后的模型数组

const chooserDialog = ref(null)                        // 远程模型选择弹窗引用
const availableModels = ref([])                        // 远程获取后的去重候选模型列表


// --- 打开模型选择弹窗 ---
async function openChooser() {
  availableModels.value = await Settings.discoverModels(props.provider, props.models) // 调用指令获取去重后的完整列表
  chooserDialog.value.show()                           // 数据就绪后打开弹窗
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
      <div>
        <m3e-heading variant="title" size="medium" level="3">模型列表</m3e-heading>
        <span>{{ props.models.length }} 个已添加模型</span>
      </div>
      <m3e-button type="button" variant="outlined" @click="openChooser">
        <m3e-icon slot="icon" name="cloud_download" filled="1"></m3e-icon>
        获取模型列表
      </m3e-button>
    </div>

    <!-- 已添加模型列表。 -->
    <div class="provider-models__list">
      <div v-for="model in props.models" :key="model.id" class="provider-models__item">
        <div class="provider-models__identity">
          <strong>{{ model.name }}</strong>
          <div class="provider-models__capabilities">
            <span v-for="capability in model.capabilities" :key="capability">{{ capability }}</span>
          </div>
        </div>
        <m3e-icon-button type="button" aria-label="移除模型" title="移除模型" @click="removeModel(model.id)">
          <m3e-icon name="delete" filled="1"></m3e-icon>
        </m3e-icon-button>
      </div>
      <p v-if="!props.models.length" class="provider-models__empty">尚未添加模型</p>
    </div>
  </section>

  <!-- 远程模型选择弹窗。 -->
  <m3e-dialog ref="chooserDialog" class="provider-models__dialog">
    <m3e-heading slot="header" variant="headline" size="small" level="2">选择模型</m3e-heading>
    <m3e-action-list class="provider-models__available" aria-label="可添加模型">
      <m3e-list-action v-for="model in availableModels" :key="model.id" @click="toggleModel(model)">
        {{ model.name }}
        <span slot="supporting-text">{{ model.capabilities.join(' · ') }}</span>
        <m3e-icon slot="trailing" :name="props.models.some(item => item.id === model.id) ? 'check' : 'add'" filled="1"></m3e-icon>
      </m3e-list-action>
    </m3e-action-list>
    <div slot="actions"><m3e-button type="button" @click="chooserDialog.hide()">关闭</m3e-button></div>
  </m3e-dialog>

</template>

<style scoped lang="scss">
/* --- 模型管理面板：垂直排列标题和列表 --- */
.provider-models { display: flex; flex-direction: column; gap: 16px; }

/* --- 标题行：左侧计数，右侧获取按钮 --- */
.provider-models__heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.provider-models__heading > div { display: flex; flex-direction: column; gap: 3px; }
.provider-models__heading span { color: #858585; font-size: 13px; }

/* --- 模型卡片列表 --- */
.provider-models__list { display: flex; flex-direction: column; gap: 6px; }

/* --- 单个模型行：名称、能力标签和移除按钮 --- */
.provider-models__item { display: flex; align-items: center; min-height: 64px; gap: 8px; padding: 10px 12px; border: 1px solid #303030; border-radius: 8px; }

/* --- 模型身份区：名称和能力标签 --- */
.provider-models__identity { display: flex; min-width: 0; flex: 1 1 auto; flex-direction: column; gap: 7px; }
.provider-models__identity strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* --- 能力标签组 --- */
.provider-models__capabilities { display: flex; flex-wrap: wrap; gap: 6px; }
.provider-models__capabilities span { padding: 2px 7px; border-radius: 5px; background: #292929; color: #bdbdbd; font-size: 11px; }

/* --- 空状态占位 --- */
.provider-models__empty { margin: 0; padding: 24px; border: 1px dashed #333333; border-radius: 8px; color: #777777; text-align: center; }

/* --- 选择弹窗候选列表 --- */
.provider-models__available { display: flex; width: min(480px, 72vw); max-width: 100%; overflow: hidden; flex-direction: column; gap: 6px; padding: 4px; }
.provider-models__available m3e-list-action { --m3e-list-item-container-color: #262626; width: 100%; }

/* --- 窄屏适配：标题行纵向堆叠 --- */
@media (max-width: 560px) {
  .provider-models__heading { align-items: stretch; flex-direction: column; }
}
</style>
