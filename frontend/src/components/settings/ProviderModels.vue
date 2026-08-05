<!-- 模型管理：从 Server 获取模型目录，批量切换并移除已添加模型。 -->
<script setup>
import { ref } from 'vue'

const props = defineProps({
  models: { type: Array, required: true },
  loading: { type: Boolean, default: false },
  fetchModels: { type: Function, required: true },
})

const emit = defineEmits(['add', 'remove'])
const chooserDialog = ref(null)
const availableModels = ref([])

async function openChooser() {
  chooserDialog.value?.show()
  const discoveredModels = await props.fetchModels()
  availableModels.value = [...new Set([...props.models, ...discoveredModels])]
}

function toggleModel(modelName) {
  if (props.models.includes(modelName)) emit('remove', modelName)
  else emit('add', modelName)
}
</script>

<template>
  <section class="provider-models">
    <div class="provider-models__heading">
      <div>
        <m3e-heading variant="title" size="medium" level="3">模型列表</m3e-heading>
        <span>{{ props.models.length }} 个已添加模型</span>
      </div>
      <m3e-button type="button" variant="outlined" :disabled="props.loading" @click="openChooser">
        <m3e-icon slot="icon" name="download"></m3e-icon>
        获取模型列表
      </m3e-button>
    </div>

    <div class="provider-models__list">
      <div v-for="modelName in props.models" :key="modelName" class="provider-models__item">
        <div class="provider-models__identity"><strong>{{ modelName }}</strong></div>
        <m3e-icon-button type="button" aria-label="移除模型" title="移除模型" @click="emit('remove', modelName)">
          <m3e-icon name="delete"></m3e-icon>
        </m3e-icon-button>
      </div>
      <p v-if="!props.models.length" class="provider-models__empty">尚未添加模型</p>
    </div>
  </section>

  <m3e-dialog ref="chooserDialog" class="provider-models__dialog">
    <m3e-heading slot="header" variant="headline" size="small" level="2">选择模型</m3e-heading>
    <div v-if="props.loading" class="provider-models__loading">
      <m3e-circular-progress-indicator variant="wavy" indeterminate aria-label="正在获取模型列表"></m3e-circular-progress-indicator>
    </div>
    <m3e-action-list v-else class="provider-models__available" aria-label="可添加模型">
      <m3e-list-action v-for="modelName in availableModels" :key="modelName" @click="toggleModel(modelName)">
        {{ modelName }}
        <m3e-icon slot="trailing" :name="props.models.includes(modelName) ? 'check' : 'add'"></m3e-icon>
      </m3e-list-action>
      <p v-if="!availableModels.length" class="provider-models__empty">没有可添加的模型</p>
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
.provider-models__empty { margin: 0; padding: 24px; border: 1px dashed #333333; border-radius: 8px; color: #777777; text-align: center; }
.provider-models__available { display: flex; width: min(480px, 72vw); max-width: 100%; overflow: hidden; flex-direction: column; gap: 6px; padding: 4px; }
.provider-models__available m3e-list-action { --m3e-list-item-container-color: #262626; width: 100%; }
.provider-models__loading { display: flex; align-items: center; justify-content: center; min-height: 180px; }
@media (max-width: 560px) { .provider-models__heading { align-items: stretch; flex-direction: column; } }
</style>
