<!-- 模型管理：选择远端模型、编辑模型能力与移除已添加模型。 -->
<script setup>
import { reactive, ref } from 'vue' // 管理两个对话框及正在编辑的模型草稿

const props = defineProps({ models: { type: Array, required: true } })
const emit = defineEmits(['update:models'])

const chooserDialog = ref(null)                        // 远端模型选择窗口
const settingsDialog = ref(null)                       // 单个模型设置窗口
const editingModel = reactive({ id: '', name: '', capabilities: [], temperature: 0.7 })
const availableModels = [
  { id: 'gpt-5.2', name: 'gpt-5.2', capabilities: ['文本', '视觉', '工具'] },
  { id: 'gpt-5-mini', name: 'gpt-5-mini', capabilities: ['文本', '工具'] },
  { id: 'o3', name: 'o3', capabilities: ['文本', '推理', '工具'] },
  { id: 'text-embedding-3-large', name: 'text-embedding-3-large', capabilities: ['向量'] },
]

// --- 添加尚未存在的远端模型 ---
function addModel(model) {
  if (props.models.some(item => item.id === model.id)) return // 已添加模型不重复写入列表

  emit('update:models', [...props.models, { ...model, temperature: 0.7 }])
  chooserDialog.value?.hide()
}


// --- 打开单个模型设置草稿 ---
function openModelSettings(model) {
  Object.assign(editingModel, structuredClone(model))
  settingsDialog.value?.show()
}


// --- 保存模型设置并替换原列表项 ---
function saveModelSettings() {
  emit('update:models', props.models.map(model => model.id === editingModel.id ? structuredClone(editingModel) : model))
  settingsDialog.value?.hide()
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
      <m3e-button type="button" variant="outlined" shape="rounded" @click="chooserDialog.show()">
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
        <m3e-icon-button type="button" shape="rounded" aria-label="模型设置" title="模型设置" @click="openModelSettings(model)">
          <m3e-icon name="tune" filled="1"></m3e-icon>
        </m3e-icon-button>
        <m3e-icon-button type="button" shape="rounded" aria-label="移除模型" title="移除模型" @click="removeModel(model.id)">
          <m3e-icon name="delete" filled="1"></m3e-icon>
        </m3e-icon-button>
      </div>
      <p v-if="!props.models.length" class="provider-models__empty">尚未添加模型</p>
    </div>
  </section>

  <m3e-dialog ref="chooserDialog" class="provider-models__dialog">
    <m3e-heading slot="header" variant="headline" size="small" level="2">选择模型</m3e-heading>
    <div class="provider-models__available">
      <button v-for="model in availableModels" :key="model.id" type="button" @click="addModel(model)">
        <span><strong>{{ model.name }}</strong><small>{{ model.capabilities.join(' · ') }}</small></span>
        <m3e-icon :name="props.models.some(item => item.id === model.id) ? 'check' : 'add'" filled="1"></m3e-icon>
      </button>
    </div>
    <div slot="actions"><m3e-button type="button" @click="chooserDialog.hide()">关闭</m3e-button></div>
  </m3e-dialog>

  <m3e-dialog ref="settingsDialog" class="provider-models__dialog">
    <m3e-heading slot="header" variant="headline" size="small" level="2">模型设置</m3e-heading>
    <div class="provider-models__settings">
      <label>模型名<input v-model="editingModel.name" type="text" /></label>
      <label>温度 <span>{{ editingModel.temperature }}</span><input v-model.number="editingModel.temperature" type="range" min="0" max="2" step="0.1" /></label>
      <fieldset>
        <legend>能力</legend>
        <label v-for="capability in ['文本', '视觉', '工具', '推理', '向量']" :key="capability">
          <input v-model="editingModel.capabilities" type="checkbox" :value="capability" />{{ capability }}
        </label>
      </fieldset>
    </div>
    <div slot="actions" class="provider-models__dialog-actions">
      <m3e-button type="button" @click="settingsDialog.hide()">取消</m3e-button>
      <m3e-button type="button" variant="filled" @click="saveModelSettings">保存</m3e-button>
    </div>
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
.provider-models__available { display: flex; min-width: min(480px, 72vw); flex-direction: column; gap: 6px; }
.provider-models__available button { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px; border: 0; border-radius: 7px; background: #262626; color: #eeeeee; text-align: left; cursor: pointer; }
.provider-models__available button:hover { background: #333333; }
.provider-models__available button span { display: flex; flex-direction: column; gap: 5px; }
.provider-models__available small { color: #999999; }
.provider-models__settings { display: flex; min-width: min(430px, 72vw); flex-direction: column; gap: 18px; }
.provider-models__settings > label { display: flex; flex-direction: column; gap: 8px; color: #bcbcbc; }
.provider-models__settings input[type='text'] { height: 44px; padding: 0 12px; border: 1px solid #444444; border-radius: 7px; background: #181818; color: #eeeeee; }
.provider-models__settings fieldset { display: flex; flex-wrap: wrap; gap: 12px; margin: 0; padding: 12px; border: 1px solid #3a3a3a; border-radius: 7px; }
.provider-models__settings fieldset label { display: flex; align-items: center; gap: 6px; }
.provider-models__dialog-actions { display: flex; gap: 8px; }

@media (max-width: 560px) {
  .provider-models__heading { align-items: flex-start; flex-direction: column; }
  .provider-models__item { align-items: flex-start; }
}
</style>
