<!--
供应商模型页：紧凑模型卡片、底部添加栏，以及可用模型和编辑模型两个底部面板。
内容顺序参考 RikkaHub ModelList / ModelSettingsForm；只展示后端支持的能力和上下文设置。
调用：<ProviderModels :provider="provider" :models="provider.models" @update:models="saveModels" />。
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Provider } from "../../features/settings.js"
import { DEFAULT_CONTEXT } from '../../defaults.js'
import Field from '../../ui/Field.vue'
import Icon from '../../ui/Icon.vue'
import ModelIcon from '../../ui/ModelIcon.vue'
import Button from '../../ui/Button.vue'
import Dialog from '../../ui/Dialog.vue'
import Menu from '../../ui/Menu.vue'
import Select from '../../ui/Select.vue'

const props = defineProps({ provider: Object, models: { type: Array, default: () => [] } })
const emit = defineEmits(['update:models'])
const loading = ref(false)
const chooserOpen = ref(false)
const available = ref([])
const filter = ref('')
const editOpen = ref(false)
const expandedId = ref('')
const editing = ref(null)
const editDraft = ref(null)
const editError = ref('')
const customContext = ref(false)

const CONTEXT_PRESETS = [32000, 128000, 200000, 512000, 1000000, 2000000]
const FAMILIES = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'moonshotai', label: 'Moonshot / Kimi' },
  { value: 'zhipuai', label: 'Zhipu / GLM' },
  { value: 'alibaba', label: 'Alibaba / Qwen' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'bytedance', label: 'ByteDance / Doubao' },
  { value: 'xai', label: 'xAI / Grok' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'meta', label: 'Meta / Llama' },
  { value: 'stepfun', label: 'StepFun' },
  { value: 'iflytek', label: 'iFlytek' },
  { value: 'baidu', label: 'Baidu / ERNIE' },
  { value: 'tencent', label: 'Tencent / Hunyuan' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'nvidia', label: 'NVIDIA' },
]
const familyOptions = computed(() => {
  const options = [{ value: '', label: '自动识别' }, ...FAMILIES]
  const family = editDraft.value?.family
  if (family && !FAMILIES.some(item => item.value === family)) options.push({ value: family, label: family })
  return options
})
const contextDraft = ref('')
const contextOpen = ref(false)
const autoSaveEnabled = ref(false)
let autoSaveTimer = null
const ABILITIES = [
  { value: 'tools', label: '工具调用' },
  { value: 'reasoning', label: '推理输出' },
]
const capabilityLabel = value => ({ text: '文本', image: '图像', tools: '工具', reasoning: '推理' }[value] || value)
const capabilityIcon = value => ({ text: 'text', image: 'image', tools: 'tools', reasoning: 'reasoning' }[value] || 'spark')
const formatContext = value => {
  const number = Number(value) || 0
  if (number >= 1000000) return `${number / 1000000}M`
  if (number >= 1000) return `${Math.round(number / 1000)}K`
  return String(number)
}
const selected = id => props.models.some(model => model.id === id)
const filtered = computed(() => {
  const query = filter.value.trim().toLowerCase()
  return available.value.filter(model => `${model.name} ${model.id}`.toLowerCase().includes(query))
})
const unselected = computed(() => filtered.value.filter(model => !selected(model.id)))

async function discover() {
  chooserOpen.value = true
  if (loading.value) return // 关闭后马上重开时继续使用同一次请求
  filter.value = ''
  loading.value = true
  try { available.value = await Provider.discoverModels(props.provider, props.models) }
  finally { loading.value = false }
}

function toggleAvailable(model) {
  emit('update:models', Provider.toggleModelInList(props.models, model))
}

function toggleAll() {
  // 批量只操作当前筛选结果；未出现在结果里的模型与已编辑元数据保持原样。
  const models = unselected.value.length
    ? [...props.models, ...unselected.value.map(model => ({ ...model }))]
    : props.models.filter(model => !filtered.value.some(item => item.id === model.id))
  emit('update:models', models)
}

function modelActions(index) {
  return [
    { value: 'up', label: '上移模型', disabled: index === 0 },
    { value: 'down', label: '下移模型', disabled: index === props.models.length - 1 },
    { value: 'remove', label: '移除模型' },
  ]
}

function runAction(model, action) {
  if (action === 'remove') { emit('update:models', props.models.filter(item => item.id !== model.id)); return }
  const models = [...props.models]
  const index = models.findIndex(item => item.id === model.id)
  const next = index + (action === 'up' ? -1 : 1)
  if (next < 0 || next >= models.length) return
  ;[models[index], models[next]] = [models[next], models[index]]
  emit('update:models', models)
}

async function openEditor(model) {
  clearTimeout(autoSaveTimer)
  autoSaveEnabled.value = false
  contextOpen.value = false
  editing.value = model?.id || null
  editDraft.value = model
    ? { ...model, name: model.name === model.id ? '' : model.name, family: model.family || '', capabilities: [...model.capabilities] }
    : { id: '', name: '', family: '', context: DEFAULT_CONTEXT, capabilities: ['text', 'tools'] }
  contextDraft.value = formatContext(editDraft.value.context)
  customContext.value = !CONTEXT_PRESETS.includes(editDraft.value.context)
  editError.value = ''
  if (model) {
    expandedId.value = model.id
    editOpen.value = false
    await nextTick()
    autoSaveEnabled.value = true
  } else {
    expandedId.value = ''
    editOpen.value = true
  }
  void detectFamily()
}

function toggleEditor(model) {
  if (expandedId.value === model.id) {
    void closeEditor()
    return
  }
  void openEditor(model)
}

async function closeEditor(save = true) {
  clearTimeout(autoSaveTimer)
  if (save && autoSaveEnabled.value && editDraft.value && editing.value) await persistModel()
  autoSaveEnabled.value = false
  expandedId.value = ''
  editing.value = null
  editDraft.value = null
  editError.value = ''
  contextOpen.value = false
}

// 外部删除或重排后，已经展开的模型不存在时自动收起。
watch(() => props.models.map(model => model.id), ids => {
  if (expandedId.value && !ids.includes(expandedId.value)) void closeEditor(false)
})

async function detectFamily() {
  if (!editDraft.value?.id || editDraft.value.family) return
  const result = await Provider.suggestFamily(editDraft.value.id)
  // 关键词只用于图标建议，不静默写成 family；只有目录命中或明确的命名空间前缀才自动落值。
  if (!result?.family || result.ambiguous || !['catalog', 'prefix'].includes(result.source)) return
  if (!editDraft.value || editDraft.value.family) return
  editDraft.value.family = result.family
}

function toggleCapability(value, enabled) {
  const current = editDraft.value.capabilities
  editDraft.value.capabilities = enabled ? [...new Set([...current, value])] : current.filter(item => item !== value)
}

function chooseContext(value) {
  customContext.value = value === null
  if (value !== null) editDraft.value.context = value
}

const parseContext = value => {
  const match = String(value ?? '').trim().toLowerCase().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([km])?$/)
  if (!match) return null
  const number = Number(match[1]) * (match[2] === 'm' ? 1000000 : match[2] === 'k' ? 1000 : 1)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null
}

function inputContext(event) {
  contextDraft.value = event.target.value
  const parsed = parseContext(contextDraft.value)
  if (parsed) editDraft.value.context = parsed
}

function blurContext() {
  const parsed = parseContext(contextDraft.value)
  contextDraft.value = formatContext(parsed || editDraft.value.context)
}

function chooseContextValue(value) {
  editDraft.value.context = value
  contextDraft.value = formatContext(value)
  contextOpen.value = false
}

async function persistModel() {
  if (!editDraft.value) return false
  const id = editDraft.value.id.trim()
  const name = editDraft.value.name.trim() || id
  const context = Number(editDraft.value.context)
  if (!id) { editError.value = '模型 ID 不能为空'; return false }
  if (editing.value && id !== editing.value && selected(id)) { editError.value = '这个模型已经在列表里了'; return false }
  if (!editing.value && selected(id)) { editError.value = '这个模型已经在列表里了'; return false }
  if (!Number.isInteger(context) || context <= 0) { editError.value = '上下文窗口需要填写正整数'; return false }
  if (!editDraft.value.family) await detectFamily()
  const model = { id, name, family: String(editDraft.value.family || '').trim(), context, capabilities: [...editDraft.value.capabilities] }
  emit('update:models', editing.value ? props.models.map(item => item.id === editing.value ? model : item) : [...props.models, model])
  editing.value = id
  expandedId.value = id
  editError.value = ''
  return true
}

async function autoSave() {
  if (!autoSaveEnabled.value || !editing.value) return
  await persistModel()
}

function scheduleAutoSave() {
  if (!autoSaveEnabled.value) return
  clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(() => void autoSave(), 450)
}

watch(editDraft, () => scheduleAutoSave(), { deep: true })
onBeforeUnmount(() => clearTimeout(autoSaveTimer))

async function saveModel() {
  if (await persistModel()) editOpen.value = false
}
</script>

<template>
  <div class="provider-models">
    <header class="provider-models__head"><h2>已添加的模型</h2><span>{{ models.length }} 个</span></header>
    <div v-if="models.length" class="provider-models__list">
      <article v-for="(model, index) in models" :key="model.id" class="model-card" :class="{ 'is-expanded': expandedId === model.id }">
        <div class="model-card__row">
          <button
            type="button"
            class="model-card__main"
            aria-label="编辑模型"
            :aria-expanded="expandedId === model.id"
            :title="`编辑 ${model.name}`"
            @click="toggleEditor(model)"
          >
            <span class="model-card__icon"><ModelIcon :model="model.id" :family="model.family" :size="24" /></span>
            <span class="model-card__copy">
              <span class="model-card__title">{{ model.name }}</span>
              <span v-if="model.name !== model.id" class="model-card__id">{{ model.id }}</span>
              <span class="model-card__meta">
                <span v-for="capability in model.capabilities" :key="capability" class="model-card__capability" role="img" :aria-label="capabilityLabel(capability)" :title="capabilityLabel(capability)"><Icon :name="capabilityIcon(capability)" :size="14" /></span>
                <span>{{ formatContext(model.context) }}</span><span v-if="index === 0" class="model-card__default">默认</span>
              </span>
            </span>
            <Icon class="model-card__chevron" :class="{ 'is-open': expandedId === model.id }" name="down" :size="16" />
          </button>
          <Menu :label="`${model.name} 的更多操作`" :items="modelActions(index)" @select="runAction(model, $event)" />
        </div>

        <div v-if="expandedId === model.id && editDraft" class="model-card__editor">
          <div class="model-edit__grid">
            <Field caption="模型 ID" label="模型 ID" v-model="editDraft.id" placeholder="例如 deepseek-chat" />
            <Field caption="显示名称" label="显示名称" v-model="editDraft.name" placeholder="留空则使用模型 ID" />
            <div class="model-edit__field">
              <span class="model-edit__caption">模型族（用于图标）</span>
              <Select class="model-edit__select" label="模型族（用于图标）" :items="familyOptions" :model-value="editDraft.family" @update:model-value="editDraft.family = $event">
                <template #selected="{ item }"><ModelIcon :model="editDraft.id" :family="item?.value || editDraft.family" :size="18" /><span>{{ item?.label || '自动识别' }}</span></template>
                <template #option="{ item }"><ModelIcon :model="editDraft.id" :family="item.value" :size="18" /><span>{{ item.label }}</span></template>
              </Select>
            </div>
            <div class="model-edit__field">
              <span class="model-edit__caption">上下文窗口</span>
              <div class="model-context" @focusout="contextOpen = $event.currentTarget.contains($event.relatedTarget) ? contextOpen : false">
                <input class="model-context__input" :value="contextDraft" aria-label="上下文窗口" placeholder="例如 1M、128K" @input="inputContext" @blur="blurContext" @keydown.esc="contextOpen = false" />
                <button class="model-context__toggle" type="button" aria-label="选择上下文长度" @click="contextOpen = !contextOpen"><Icon name="down" :size="16" /></button>
                <div v-if="contextOpen" class="model-context__menu">
                  <button v-for="preset in CONTEXT_PRESETS" :key="preset" type="button" @mousedown.prevent @click="chooseContextValue(preset)">{{ formatContext(preset) }}</button>
                </div>
              </div>
            </div>
          </div>

          <div class="model-edit__abilities">
            <fieldset class="model-edit__section"><legend>输入能力</legend>
              <div class="model-choices"><span class="model-choice is-selected"><Icon name="check" :size="16" />文本</span><label class="model-choice" :class="{ 'is-selected': editDraft.capabilities.includes('image') }"><input type="checkbox" role="switch" aria-label="图像输入" :checked="editDraft.capabilities.includes('image')" @change="toggleCapability('image', $event.target.checked)" /><Icon v-if="editDraft.capabilities.includes('image')" name="check" :size="16" />图像输入</label></div>
            </fieldset>
            <fieldset class="model-edit__section"><legend>模型能力</legend>
              <div class="model-choices"><label v-for="ability in ABILITIES" :key="ability.value" class="model-choice" :class="{ 'is-selected': editDraft.capabilities.includes(ability.value) }"><input type="checkbox" role="switch" :aria-label="ability.label" :checked="editDraft.capabilities.includes(ability.value)" @change="toggleCapability(ability.value, $event.target.checked)" /><Icon v-if="editDraft.capabilities.includes(ability.value)" name="check" :size="16" />{{ ability.label }}</label></div>
            </fieldset>
          </div>
          <p class="model-edit__hint">修改后自动保存；上下文窗口支持 1M、100K、512K 这类写法。</p>
          <p v-if="editError" class="model-edit__error" role="alert">{{ editError }}</p>
        </div>
      </article>
    </div>
    <div v-else class="provider-models__empty"><Icon name="model" :size="40" /><strong>还没有模型</strong><p>从服务商获取，或手动添加模型 ID</p></div>
    <div class="provider-models__toolbar" aria-label="模型操作">
      <Button variant="text" :aria-busy="loading" @click="discover"><Icon name="download" :size="18" />{{ loading ? '获取中…' : '获取模型列表' }}</Button>
      <Button @click="openEditor()"><Icon name="plus" :size="18" />添加模型</Button>
    </div>
  </div>

  <Dialog :open="chooserOpen" placement="bottom" :width="680" label="可用模型" class="model-picker-sheet" @update:open="chooserOpen = $event">
    <div class="model-chooser">
      <div class="model-chooser__summary"><span>{{ loading ? '正在获取模型…' : `共 ${filtered.length} 个 · 已添加 ${models.length} 个` }}</span><Button variant="text" :disabled="loading || !filtered.length" @click="toggleAll">{{ unselected.length ? '全部添加' : '移除已选' }}</Button></div>
      <div class="model-chooser__list" :aria-busy="loading">
        <button v-for="model in filtered" :key="model.id" type="button" class="model-chooser__row" :aria-pressed="selected(model.id)" @click="toggleAvailable(model)">
          <ModelIcon :model="model.id" :family="model.family" :size="24" /><span><strong>{{ model.name }}</strong><small v-if="model.id !== model.name">{{ model.id }}</small></span>
          <span class="model-chooser__mark" :class="{ 'is-selected': selected(model.id) }"><Icon :name="selected(model.id) ? 'check' : 'plus'" :size="18" /></span>
        </button>
        <p v-if="!loading && !filtered.length" class="model-chooser__empty">{{ filter ? '没有匹配的模型' : '暂未获取到模型，可以手动添加' }}</p>
      </div>
    </div>
    <template #footer><Field v-model="filter" type="search" label="过滤模型" placeholder="按名称或 ID 过滤" clearable size="small"><template #leading><Icon name="search" :size="18" /></template></Field><Button variant="text" @click="chooserOpen = false">完成</Button></template>
  </Dialog>

  <Dialog :open="editOpen" placement="bottom" :width="680" :label="editing ? '编辑模型' : '添加模型'" class="model-editor-sheet" @update:open="editOpen = $event">
    <div v-if="editDraft" class="model-edit">
      <div class="model-edit__identity">
        <Field caption="模型 ID" label="模型 ID" v-model="editDraft.id" placeholder="例如 deepseek-chat" />
        <Field caption="显示名称" label="显示名称" v-model="editDraft.name" placeholder="留空则使用模型 ID" />
        <div class="model-edit__field">
          <span class="model-edit__caption">模型族（用于图标）</span>
          <Select class="model-edit__select" label="模型族（用于图标）" :items="familyOptions" :model-value="editDraft.family" @update:model-value="editDraft.family = $event">
            <template #selected="{ item }"><ModelIcon :model="editDraft.id" :family="item?.value || editDraft.family" :size="18" /><span>{{ item?.label || '自动识别' }}</span></template>
            <template #option="{ item }"><ModelIcon :model="editDraft.id" :family="item.value" :size="18" /><span>{{ item.label }}</span></template>
          </Select>
        </div>
      </div>
      <fieldset class="model-edit__section"><legend>输入能力</legend>
        <div class="model-choices"><span class="model-choice is-selected"><Icon name="check" :size="16" />文本</span><label class="model-choice" :class="{ 'is-selected': editDraft.capabilities.includes('image') }"><input type="checkbox" role="switch" aria-label="图像输入" :checked="editDraft.capabilities.includes('image')" @change="toggleCapability('image', $event.target.checked)" /><Icon v-if="editDraft.capabilities.includes('image')" name="check" :size="16" />图像输入</label></div>
      </fieldset>
      <fieldset class="model-edit__section"><legend>模型能力</legend>
        <div class="model-choices"><label v-for="ability in ABILITIES" :key="ability.value" class="model-choice" :class="{ 'is-selected': editDraft.capabilities.includes(ability.value) }"><input type="checkbox" role="switch" :aria-label="ability.label" :checked="editDraft.capabilities.includes(ability.value)" @change="toggleCapability(ability.value, $event.target.checked)" /><Icon v-if="editDraft.capabilities.includes(ability.value)" name="check" :size="16" />{{ ability.label }}</label></div>
      </fieldset>
      <fieldset class="model-edit__section"><legend>上下文窗口</legend>
        <div class="model-choices model-choices--context"><label v-for="preset in [...CONTEXT_PRESETS, null]" :key="preset || 'custom'" class="model-choice" :class="{ 'is-selected': preset === null ? customContext : !customContext && editDraft.context === preset }"><input type="radio" name="model-context" :aria-label="preset === null ? '自定义上下文' : formatContext(preset)" :checked="preset === null ? customContext : !customContext && editDraft.context === preset" @change="chooseContext(preset)" />{{ preset === null ? '自定义' : formatContext(preset) }}</label></div>
        <Field v-if="customContext" v-model="editDraft.context" type="number" label="上下文窗口" :min="1" :step="1000" size="small"><template #trailing><span class="model-edit__unit">tokens</span></template></Field>
        <p class="model-edit__hint">模型一次能处理的内容长度，按服务商提供的数值填写</p>
      </fieldset>
      <p v-if="editError" class="model-edit__error" role="alert">{{ editError }}</p>
    </div>
    <template #footer><Button variant="text" @click="editOpen = false">取消</Button><Button @click="saveModel">{{ editing ? '保存模型' : '添加' }}</Button></template>
  </Dialog>
</template>

<style scoped lang="scss" src="../../styles/components/providers/ProviderModels.scss"></style>
