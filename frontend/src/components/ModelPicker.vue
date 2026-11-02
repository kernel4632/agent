<!-- 模型选择面板：搜索、分组与选中反馈独立变化；保存动作由调用方处理。
调用：<ModelPicker v-model:open="open" :providers="providers" :model="model" :provider="provider" @choose="choose" />。
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { Icon, Button, Field, ModelIcon, Dialog } from '../ui/index.js'

const props = defineProps({ providers: { type: Object, required: true }, model: String, provider: String })
const open = defineModel('open', { type: Boolean, default: false })
const emit = defineEmits(['choose', 'configure'])
const query = ref('') // 搜索文字只属于面板，不写入会话设置
watch(open, value => { if (value) query.value = '' })
const groups = computed(() => Object.entries(props.providers)
  .filter(([, config]) => config.enabled)
  .map(([provider, config]) => ({
    provider,
    models: config.models.map(model => typeof model === 'string' ? model : model.id || model.name)
      .filter(model => !query.value.trim() || model.toLowerCase().includes(query.value.trim().toLowerCase())),
  }))
  .filter(group => group.models.length))
function choose(provider, model) {
  open.value = false // 先收起面板，再由父级保存会话模型
  emit('choose', provider, model)
}
</script>
<template>
  <Dialog placement="bottom" :open="open" label="选择模型" @update:open="open = $event">
    <div class="composer-sheet composer-sheet--models">
      <Field v-model="query" type="search" label="搜索模型" placeholder="搜索模型">
        <template #leading><Icon name="search" :size="20" /></template>
      </Field>
      <div v-if="groups.length" class="model-list">
        <section v-for="group in groups" :key="group.provider" class="model-group">
          <h3>{{ group.provider }}</h3>
          <button v-for="item in group.models" :key="item" type="button" class="model-row" :class="{ 'is-selected': item === model && group.provider === provider }" :aria-pressed="item === model && group.provider === provider" @click="choose(group.provider, item)">
            <span class="model-row__icon"><ModelIcon :model="item" :provider="group.provider" :size="28" /></span>
            <span class="model-row__name">{{ item }}</span>
            <Icon v-if="item === model && group.provider === provider" name="check" :size="20" />
          </button>
        </section>
      </div>
      <div v-else class="composer-sheet__empty">
        <p>还没有可用模型。</p>
        <Button @click="open = false; emit('configure')">打开模型设置</Button>
      </div>
    </div>
  </Dialog>
</template>
<style scoped lang="scss" src="../styles/components/ModelPicker.scss"></style>
