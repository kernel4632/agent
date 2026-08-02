<!-- 模型管理：批量选择远端模型，并移除已添加模型。 -->
<script setup>
import { ref } from 'vue' // 管理远端模型选择窗口

const props = defineProps({ models: { type: Array, required: true } })
const emit = defineEmits(['update:models'])

const chooserDialog = ref(null)                        // 远端模型选择窗口
const availableModels = [
  { id: 'gpt-5.2', name: 'gpt-5.2', capabilities: ['文本', '视觉', '工具'] },
  { id: 'gpt-5-mini', name: 'gpt-5-mini', capabilities: ['文本', '工具'] },
  { id: 'o3', name: 'o3', capabilities: ['文本', '推理', '工具'] },
  { id: 'text-embedding-3-large', name: 'text-embedding-3-large', capabilities: ['向量'] },
]

// --- 在选择窗中切换模型的添加状态 ---
function toggleModel(model) {
  const modelExists = props.models.some(item => item.id === model.id)
  if (modelExists) {
    emit('update:models', props.models.filter(item => item.id !== model.id)) // 再次点击已选模型即取消
    return
  }

  emit('update:models', [...props.models, { ...model }])                       // 未选模型加入当前供应商
}


function removeModel(modelId) {
  emit('update:models', props.models.filter(model => model.id !== modelId))
}
</script>

<template>
  <section class="provider-models">
    <div class="provider-models__heading">
      <div>
        <m3e-heading variant="title" size="medium" level="3">模型列表</m3e-heading>
        <span>{{ props.models.length }} 个已添加模型</span>
      </div>
      <m3e-button type="button" variant="outlined" @click="chooserDialog.show()">
        <m3e-icon slot="icon" name="cloud_download" filled="1"></m3e-icon>
        获取模型列表
      </m3e-button>
    </div>

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
.provider-models { display: flex; flex-direction: column; gap: 16px; }
.provider-models__heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.provider-models__heading > div { display: flex; flex-direction: column; gap: 3px; }
.provider-models__heading span { color: #858585; font-size: 13px; }
.provider-models__list { display: flex; flex-direction: column; gap: 6px; }
.provider-models__item { display: flex; align-items: center; min-height: 64px; gap: 8px; padding: 10px 12px; border: 1px solid #303030; border-radius: 8px; }
.provider-models__identity { display: flex; min-width: 0; flex: 1 1 auto; flex-direction: column; gap: 7px; }
.provider-models__identity strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.provider-models__capabilities { display: flex; flex-wrap: wrap; gap: 6px; }
.provider-models__capabilities span { padding: 2px 7px; border-radius: 5px; background: #292929; color: #bdbdbd; font-size: 11px; }
.provider-models__empty { margin: 0; padding: 24px; border: 1px dashed #333333; border-radius: 8px; color: #777777; text-align: center; }
.provider-models__available { display: flex; width: min(480px, 72vw); max-width: 100%; overflow: hidden; flex-direction: column; gap: 6px; padding: 4px; }
.provider-models__available m3e-list-action { --m3e-list-item-container-color: #262626; width: 100%; }
@media (max-width: 560px) {
  .provider-models__heading { align-items: stretch; flex-direction: column; }
}
</style>
