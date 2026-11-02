<!--
供应商模型页：列出模型、发现远程模型、手动添加，并编辑每个模型的名称、能力和上下文窗口。
数据只通过 update:models 交给上层；发现请求、弹窗和编辑草稿都是本地状态。
名称、上下文窗口和能力一起保存在模型对象中；能力使用后端规定的英文标识，界面显示中文。
调用示例：<ProviderModels :provider="provider" :models="provider.models" @update:models="setModels" />
-->
<script setup>
import { Provider } from '../../commands/provider.js'

import { Notice } from '../../commands/notice.js'

import { computed, ref } from 'vue'
import Chip from '../../ui/Chip.vue'
import Field from '../../ui/Field.vue'
import Icon from '../../ui/Icon.vue'
import Button from '../../ui/Button.vue'
import Dialog from '../../ui/Dialog.vue'
import Switch from '../../ui/Switch.vue'
import { DEFAULT_CONTEXT } from '../../defaults.js'

const props = defineProps({ provider: Object, models: { type: Array, default: () => [] } })
const emit = defineEmits(['update:models'])

const manual = ref('')
const loading = ref(false)
const chooserOpen = ref(false)
const available = ref([])
const filter = ref('')
const editing = ref(null)
const editDraft = ref(null)
const editError = ref('')

// 常见的上下文窗口，点一下比手填数字快；数字是 token 数，不是字符数。
const CONTEXT_PRESETS = [32000, 64000, 128000, 200000, 1000000]
const CAPABILITIES = [
  { value: 'tools', label: '工具调用', hint: '允许模型调用读文件、执行命令等工具' },
  { value: 'image', label: '图像输入', hint: '允许把图片发给这个模型' },
  { value: 'reasoning', label: '推理输出', hint: '模型会返回思考过程' },
]

const filtered = computed(() => {
  const query = filter.value.trim().toLowerCase()
  if (!query) return available.value
  return available.value.filter(model => `${model.name} ${model.id}`.toLowerCase().includes(query))
})

const defaultCapabilities = () => ['text', 'tools']
const capabilityLabel = value => value === 'text' ? '文本' : CAPABILITIES.find(item => item.value === value)?.label || value
const formatContext = value => {
  if (!value) return '未设置'
  if (value >= 1000000) return `${Math.round(value / 100000) / 10}M`
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}
const newModel = id => ({ id, name: id, capabilities: defaultCapabilities(), context: DEFAULT_CONTEXT })

function addManual() {
  const id = manual.value.trim()
  if (!id) return
  if (props.models.some(model => model.id === id)) { Notice.show('这个模型已经在列表里了'); return }
  emit('update:models', [...props.models, newModel(id)])
  manual.value = ''
}

async function discover() {
  if (loading.value) return
  loading.value = true
  try {
    available.value = await Provider.discoverModels(props.provider, props.models)
    filter.value = ''
    chooserOpen.value = true
  } finally {
    loading.value = false
  }
}

function toggleAvailable(model) {
  const exists = props.models.some(item => item.id === model.id)
  if (exists) emit('update:models', props.models.filter(item => item.id !== model.id))
  else emit('update:models', [...props.models, { ...newModel(model.id), name: model.name || model.id }])
}

function removeModel(id) {
  emit('update:models', props.models.filter(item => item.id !== id))
}

// 第一个模型会作为默认模型；上下移动比拖拽更容易用键盘操作。
function moveModel(index, offset) {
  const next = [...props.models]
  const target = index + offset
  if (target < 0 || target >= next.length) return
  ;[next[index], next[target]] = [next[target], next[index]]
  emit('update:models', next)
}

function editModel(model) {
  editing.value = model.id
  editDraft.value = { ...model, capabilities: [...(model.capabilities || defaultCapabilities())] }
  editError.value = ''
}

function hasCapability(label) {
  return editDraft.value?.capabilities?.includes(label)
}

function toggleCapability(label, enabled) {
  const current = editDraft.value.capabilities || []
  editDraft.value.capabilities = enabled
    ? [...new Set([...current, label])]
    : current.filter(item => item !== label)
}

function setContext(value) {
  if (Number.isFinite(value) && value >= 0) editDraft.value.context = value
}

function saveModel() {
  const id = String(editDraft.value?.id || '').trim()
  const name = String(editDraft.value?.name || '').trim()
  if (!id) { editError.value = '模型 ID 不能为空'; return }
  if (!name) { editError.value = '显示名称不能为空'; return }
  const next = { id, name, capabilities: editDraft.value.capabilities?.length ? editDraft.value.capabilities : defaultCapabilities(), context: Number(editDraft.value.context) || 0 }
  emit('update:models', props.models.map(model => model.id === editing.value ? next : model))
  editing.value = null
  editDraft.value = null
}
</script>

<template>
  <div class="provider-models">
    <header class="provider-models__head">
      <div>
        <h3 class="provider-models__title">模型</h3>
        <p>{{ models.length }} 个模型。列表里的第一个会作为这个供应商的默认模型。</p>
      </div>
      <Button variant="tonal" :disabled="loading" @click="discover">
        <Icon name="download" :size="18" />
        <span>{{ loading ? '获取中…' : '获取模型列表' }}</span>
      </Button>
    </header>

    <div class="provider-models__add">
      <Field
        v-model="manual"
        class="provider-models__input"
        label="手动添加模型 ID"
        placeholder="例如 deepseek-chat"
        clearable
        @keydown.enter.prevent="addManual"
      />
      <Button :disabled="!manual.trim()" @click="addManual">
        <Icon name="plus" :size="18" />
        <span>添加模型</span>
      </Button>
    </div>

    <p v-if="!models.length" class="provider-models__empty">还没有模型。可以获取供应商支持的模型，也可以手动填一个 ID。</p>

    <div v-else class="provider-models__list">
      <div v-for="(model, index) in models" :key="model.id" class="ui-card model-card"><div class="ui-card__body">
        <div class="model-card__main">
          <div class="model-card__title">
            <Icon name="model" :size="20" />
            <strong>{{ model.name }}</strong>
            <span v-if="model.name !== model.id">{{ model.id }}</span>
          </div>
          <div class="model-card__meta">
             <Chip v-for="capability in model.capabilities" :key="capability">{{ capabilityLabel(capability) }}</Chip>
            <span class="model-card__context">上下文 {{ formatContext(model.context) }}</span>
          </div>
        </div>
        <div class="model-card__actions">
          <Button icon label="上移模型" variant="text" :disabled="index === 0" @click="moveModel(index, -1)"><Icon name="up" :size="18" /></Button>
          <Button icon label="下移模型" variant="text" :disabled="index === models.length - 1" @click="moveModel(index, 1)"><Icon name="down" :size="18" /></Button>
          <Button icon label="编辑模型" variant="text" @click="editModel(model)"><Icon name="edit" :size="18" /></Button>
          <Button icon :label="`移除模型 ${model.name}`" variant="text" @click="removeModel(model.id)"><Icon name="trash" :size="18" /></Button>
        </div>
      </div></div>
    </div>
  </div>

  <Dialog :open="chooserOpen" label="选择模型" @update:open="chooserOpen = $event">
    <div class="model-chooser">
      <Field v-model="filter" label="过滤模型" placeholder="按名称或 ID 过滤" clearable />
      <div class="model-chooser__list">
        <Button
          v-for="model in filtered"
          :key="model.id"
          variant="plain"
          class="model-chooser__row"
          :aria-pressed="models.some(item => item.id === model.id)"
          @click="toggleAvailable(model)"
        >
          <Icon name="model" :size="20" />
          <span class="model-chooser__name">{{ model.name }}</span>
          <span class="model-chooser__id">{{ model.id }}</span>
          <Icon v-if="models.some(item => item.id === model.id)" name="check" :size="18" class="model-chooser__check" />
        </Button>
        <p v-if="!filtered.length" class="model-chooser__empty">没有匹配的模型。</p>
      </div>
    </div>
    <template #footer>
      <Button variant="text" @click="chooserOpen = false">关闭</Button>
    </template>
  </Dialog>

  <Dialog :open="Boolean(editing)" label="编辑模型" @update:open="value => { if (!value) editing = null }">
    <div v-if="editDraft" class="model-edit">
      <Field caption="模型 ID" label="模型 ID" :model-value="editDraft.id" readonly />
      <Field caption="显示名称" label="显示名称" :model-value="editDraft.name" clearable @update:model-value="editDraft.name = $event" />

      <div class="model-edit__field">
        <span class="model-edit__label">能力</span>
        <Switch
          v-for="item in CAPABILITIES"
          :key="item.value"
          :model-value="hasCapability(item.value)"
          :label="item.label"
          @update:model-value="toggleCapability(item.value, $event)"
        />
        <p class="model-edit__hint">{{ CAPABILITIES.map(item => `${item.label}：${item.hint}`).join('；') }}。</p>
      </div>

      <div class="model-edit__field">
        <span class="model-edit__label">上下文窗口</span>
        <div class="model-edit__presets">
          <Chip
            v-for="preset in CONTEXT_PRESETS"
            :key="preset"
            selectable
            :model-value="Number(editDraft.context) === preset"
            @update:model-value="value => setContext(value ? preset : 0)"
          >{{ formatContext(preset) }}</Chip>
        </div>
        <Field type="number" label="上下文窗口" :min="0" :step="1000" :model-value="Number(editDraft.context) || 0" @update:model-value="setContext" />
        <p class="model-edit__hint">不填就按 128K 处理；填了以后压缩阈值按这个窗口计算。</p>
      </div>
      <p v-if="editError" class="model-edit__error" role="alert">{{ editError }}</p>
    </div>
    <template #footer>
      <Button variant="text" @click="editing = null">取消</Button>
      <Button @click="saveModel">保存模型</Button>
    </template>
  </Dialog>
</template>

<style scoped lang="scss" src="../../styles/components/providers/ProviderModels.scss"></style>
