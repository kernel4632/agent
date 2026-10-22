<!--
供应商模型列表：展示已选模型，支持从供应商发现模型、手动添加和移除，弹窗内切换选中模型。
数据只通过 update:models 交给上层；发现请求、手动输入和弹窗开关是本地状态。
控件统一用 ui/ 的 Button、Field、IconButton、Dialog。
调用示例：<ProviderModels :provider="provider" :models="provider.models" @update:models="setModels" />
-->
<script setup>
import { ref } from 'vue'
import { AppIcon, Button, Dialog, Field, IconButton } from '../../ui/index.js'
import { Settings } from '../../commands/settings.js'

const props = defineProps({ provider: Object, models: Array })
const emit = defineEmits(['update:models'])
const manual = ref('')
const loading = ref(false)
const chooserOpen = ref(false)
const available = ref([])

// 手动添加：去掉首尾空白，空值或已存在的模型不重复写入。
function add() {
  const id = manual.value.trim()
  if (!id) return
  if (!props.models.some(model => model.id === id)) emit('update:models', [...props.models, { id, name: id, capabilities: ['文本', '工具'] }])
  manual.value = ''
}

// 模型发现：请求期间禁用按钮，成功后把结果放进弹窗供勾选。
async function discover() {
  if (loading.value) return
  loading.value = true
  try { available.value = await Settings.discoverModels(props.provider, props.models); chooserOpen.value = true }
  finally { loading.value = false }
}
</script>

<template>
  <section class="provider-models">
    <header><h3>模型列表 <small>{{ models.length }}</small></h3><Button variant="ghost" :disabled="loading" @click="discover">{{ loading ? '获取中…' : '获取模型列表' }}</Button></header>
    <div class="provider-models__add">
      <Field
        v-model="manual"
        class="provider-models__manual"
        label="手动添加模型 ID"
        placeholder="输入模型 ID"
        @keydown.enter.prevent="add"
      />
      <Button :disabled="!manual.trim()" @click="add">添加模型</Button>
    </div>
    <div v-for="model in models" :key="model.id" class="provider-models__row"><span>{{ model.name }}</span><IconButton :label="`移除模型 ${model.name}`" @click="emit('update:models', models.filter(item => item.id !== model.id))"><AppIcon name="close" :size="14" /></IconButton></div>
    <p v-if="!models.length">尚未添加模型</p>
  </section>
  <Dialog :open="chooserOpen" label="选择模型" @update:open="chooserOpen = $event">
    <h2>选择模型</h2>
    <div class="model-choices">
      <Button v-for="model in available" :key="model.id" :aria-pressed="models.some(item => item.id === model.id)" @click="emit('update:models', Settings.toggleModelInList(models, model))">{{ model.name }}<AppIcon v-if="models.some(item => item.id === model.id)" name="check" :size="14" /></Button>
    </div>
    <div class="dialog-actions"><Button @click="chooserOpen = false">关闭</Button></div>
  </Dialog>
</template>

<style scoped lang="scss">
.provider-models {
  display: grid;
  gap: 12px;
  header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  h3 { margin: 0; font-size: 13px; font-weight: 530; }
  small { color: var(--la-muted); margin-left: 6px; }
  &__add { display: flex; gap: 8px; }
  &__manual { flex: 1; min-width: 0; }
  &__add :deep(.field) { min-width: 0; font-size: 13px; }
  &__add .button { flex: none; }
  &__row { display: flex; min-height: 28px; align-items: center; justify-content: space-between; gap: 8px; padding: 0 4px 0 10px; border-radius: 4px; background: var(--la-layer-01); font-size: 13px; overflow-wrap: anywhere; }
  p { margin: 0; text-align: center; color: var(--la-muted); font-size: 13px; }
}
.model-choices { display: grid; gap: 6px; margin-top: 16px; max-height: 50vh; overflow: auto; }
.model-choices .button { justify-content: space-between; overflow-wrap: anywhere; }
</style>
