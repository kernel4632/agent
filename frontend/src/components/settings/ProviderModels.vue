<script setup>
import { ref } from 'vue'
import AppIcon from '../AppIcon.vue'
import { Settings } from '../../commands/settings.js'
const props = defineProps({ provider: Object, models: Array })
const emit = defineEmits(['update:models'])
const manual = ref('')
const loading = ref(false)
const chooser = ref(null)
const available = ref([])
function add() {
  const id = manual.value.trim()
  if (!id) return
  if (!props.models.some(model => model.id === id)) emit('update:models', [...props.models, { id, name: id, capabilities: ['文本', '工具'] }])
  manual.value = ''
}
async function discover() {
  if (loading.value) return
  loading.value = true
  try { available.value = await Settings.discoverModels(props.provider, props.models); chooser.value.showModal() }
  finally { loading.value = false }
}
</script>

<template>
  <section class="provider-models">
    <header><h3>模型列表 <small>{{ models.length }}</small></h3><button class="text-button" :disabled="loading" @click="discover">{{ loading ? '获取中…' : '获取模型列表' }}</button></header>
    <div class="provider-models__add"><input v-model="manual" class="field" aria-label="手动添加模型 ID" placeholder="输入模型 ID" @keydown.enter.prevent="add" /><button class="button" :disabled="!manual.trim()" @click="add">添加模型</button></div>
    <div v-for="model in models" :key="model.id" class="provider-models__row"><span>{{ model.name }}</span><button class="icon-button" :aria-label="`移除模型 ${model.name}`" @click="emit('update:models', models.filter(item => item.id !== model.id))"><AppIcon name="close" :size="14" /></button></div>
    <p v-if="!models.length">尚未添加模型</p>
  </section>
  <dialog ref="chooser" class="dialog" aria-label="选择模型"><h2>选择模型</h2><div class="model-choices"><button v-for="model in available" :key="model.id" class="button" :aria-pressed="models.some(item => item.id === model.id)" @click="emit('update:models', Settings.toggleModelInList(models, model))">{{ model.name }}<AppIcon v-if="models.some(item => item.id === model.id)" name="check" :size="14" /></button></div><div class="dialog-actions"><button class="button" @click="chooser.close()">关闭</button></div></dialog>
</template>

<style scoped lang="scss">
.provider-models {
  header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  h3 { font-size: 13px; font-weight: 500; }
  small { color: var(--la-muted); margin-left: 6px; }
  &__add { display: flex; gap: 8px; margin-bottom: 12px; }
  &__add .field { min-width: 0; font-size: 12px; }
  &__add .button { flex: none; }
  &__row { display: flex; align-items: center; justify-content: space-between; padding: 5px 8px 5px 12px; margin-bottom: 2px; border-radius: 5px; background: var(--la-setting-row); font-size: 12px; overflow-wrap: anywhere; }
  p { text-align: center; color: var(--la-muted); font-size: 12px; }
}
.model-choices { display: grid; gap: 6px; margin-top: 16px; max-height: 50vh; overflow: auto; }
.model-choices .button { justify-content: space-between; overflow-wrap: anywhere; }
</style>
