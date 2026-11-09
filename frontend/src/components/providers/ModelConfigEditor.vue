<!--
单个模型的展开编辑器：基础信息、能力、上下文和高级生成参数。
每张卡自带草稿和自动保存，多个模型可以同时展开。
调用：<ModelConfigEditor :model="model" :items="familyOptions" @save="saveModel" />。
-->
<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Field from '../../ui/Field.vue'
import Icon from '../../ui/Icon.vue'
import ModelFamilyInput from './ModelFamilyInput.vue'

const props = defineProps({
  model: { type: Object, required: true },
  items: { type: Array, default: () => [] },
  usedIds: { type: Array, default: () => [] },
})
const emit = defineEmits(['save'])

const originalId = ref(props.model.id)
const draft = ref({
  id: props.model.id,
  name: props.model.name === props.model.id ? '' : (props.model.name || ''),
  family: props.model.family || '',
  context: props.model.context,
  capabilities: [...(props.model.capabilities || [])],
  maxOutput: props.model.maxOutput ?? '',
  temperature: props.model.temperature ?? '',
  topP: props.model.topP ?? '',
  seed: props.model.seed ?? '',
})
const contextDraft = ref(formatContext(props.model.context))
const contextOpen = ref(false)
const bodyText = ref(props.model.body && Object.keys(props.model.body).length ? JSON.stringify(props.model.body, null, 2) : '')
const advancedOpen = ref([props.model.maxOutput, props.model.temperature, props.model.topP, props.model.seed].some(value => value !== undefined) || bodyText.value !== '')
const error = ref('')
const autoSaveEnabled = ref(false)
let autoSaveTimer = null
let lastSaved = ''
const CONTEXT_PRESETS = [32000, 128000, 200000, 512000, 1000000, 2000000]
const ABILITIES = [
  { value: 'tools', label: '工具调用' },
  { value: 'reasoning', label: '推理输出' },
  { value: 'reasoning-replay', label: '回传思考' },
]

function formatContext(value) {
  const number = Number(value) || 0
  if (number >= 1000000) return `${number / 1000000}M`
  if (number >= 1000) return `${Math.round(number / 1000)}K`
  return String(number)
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
  if (parsed) draft.value.context = parsed
}

function blurContext() {
  const parsed = parseContext(contextDraft.value)
  contextDraft.value = formatContext(parsed || draft.value.context)
}

function chooseContext(value) {
  draft.value.context = value
  contextDraft.value = formatContext(value)
  contextOpen.value = false
}

function toggleCapability(value, enabled) {
  const current = draft.value.capabilities
  draft.value.capabilities = enabled ? [...new Set([...current, value])] : current.filter(item => item !== value)
}

function modelPayload() {
  const id = String(draft.value.id || '').trim()
  if (!id) { error.value = '模型 ID 不能为空'; return null }
  if (id !== originalId.value && props.usedIds.includes(id)) { error.value = '这个模型已经在列表里了'; return null }
  const context = Number(draft.value.context)
  if (!Number.isInteger(context) || context <= 0) { error.value = '上下文窗口需要填写正整数'; return null }

  const result = {
    id,
    name: String(draft.value.name || '').trim() || id,
    family: String(draft.value.family || '').trim(),
    context,
    capabilities: [...draft.value.capabilities],
  }

  if (draft.value.maxOutput !== '' && draft.value.maxOutput !== null) {
    const value = Number(draft.value.maxOutput)
    if (!Number.isInteger(value) || value <= 0) { error.value = '最大输出需要填写正整数'; return null }
    result.maxOutput = value
  }
  if (draft.value.temperature !== '' && draft.value.temperature !== null) {
    const value = Number(draft.value.temperature)
    if (!Number.isFinite(value) || value < 0 || value > 2) { error.value = '温度需要填写 0 到 2 之间的数字'; return null }
    result.temperature = value
  }
  if (draft.value.topP !== '' && draft.value.topP !== null) {
    const value = Number(draft.value.topP)
    if (!Number.isFinite(value) || value < 0 || value > 1) { error.value = 'Top P 需要填写 0 到 1 之间的数字'; return null }
    result.topP = value
  }
  if (draft.value.seed !== '' && draft.value.seed !== null) {
    const value = Number(draft.value.seed)
    if (!Number.isInteger(value) || value < 0) { error.value = '随机种子需要填写非负整数'; return null }
    result.seed = value
  }
  const body = String(bodyText.value || '').trim()
  if (body) {
    try {
      const parsed = JSON.parse(body)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object')
      if (Object.keys(parsed).length) result.body = parsed
    } catch {
      error.value = '其他参数必须是合法的 JSON 对象'
      return null
    }
  }
  return result
}

function persist() {
  if (!autoSaveEnabled.value) return
  const model = modelPayload()
  if (!model) return
  const previous = originalId.value
  const signature = JSON.stringify(model)
  if (signature === lastSaved) return
  lastSaved = signature
  error.value = ''
  emit('save', { originalId: previous, model })
  originalId.value = model.id
}

function scheduleSave() {
  if (!autoSaveEnabled.value) return
  clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(persist, 450)
}

watch([draft, bodyText], scheduleSave, { deep: true })
onBeforeUnmount(() => {
  clearTimeout(autoSaveTimer)
  if (autoSaveEnabled.value) persist()
})
nextTick(() => { autoSaveEnabled.value = true })
</script>

<template>
  <div class="model-config-editor">
    <div class="model-edit__grid">
      <!-- 已保存的模型不能改 ID：ID 是它在列表和请求里的身份，改了会和任务模型指向对不上。 -->
      <Field caption="模型 ID" label="模型 ID" v-model="draft.id" :readonly="Boolean(originalId)" placeholder="例如 deepseek-chat" />
      <Field caption="显示名称" label="显示名称" v-model="draft.name" placeholder="留空则使用模型 ID" />
      <ModelFamilyInput v-model="draft.family" :model-id="draft.id" :items="items" />
      <div class="model-edit__field">
        <span class="model-edit__caption">上下文窗口</span>
        <div class="model-context" @focusout="contextOpen = $event.currentTarget.contains($event.relatedTarget) ? contextOpen : false">
          <input class="model-context__input" :value="contextDraft" aria-label="上下文窗口" placeholder="例如 1M、128K" @input="inputContext" @blur="blurContext" @keydown.esc="contextOpen = false" />
          <button class="model-context__toggle" type="button" aria-label="选择上下文长度" @click="contextOpen = !contextOpen"><Icon name="down" :size="16" /></button>
          <div v-if="contextOpen" class="model-context__menu">
            <button v-for="preset in CONTEXT_PRESETS" :key="preset" type="button" @mousedown.prevent @click="chooseContext(preset)">{{ formatContext(preset) }}</button>
          </div>
        </div>
      </div>
    </div>

    <div class="model-edit__abilities">
      <fieldset class="model-edit__section"><legend>输入能力</legend>
        <div class="model-choices"><span class="model-choice is-selected"><Icon name="check" :size="16" />文本</span><label class="model-choice" :class="{ 'is-selected': draft.capabilities.includes('image') }"><input type="checkbox" role="switch" aria-label="图像输入" :checked="draft.capabilities.includes('image')" @change="toggleCapability('image', $event.target.checked)" /><Icon v-if="draft.capabilities.includes('image')" name="check" :size="16" />图像输入</label></div>
      </fieldset>
      <fieldset class="model-edit__section"><legend>模型能力</legend>
        <div class="model-choices"><label v-for="ability in ABILITIES" :key="ability.value" class="model-choice" :class="{ 'is-selected': draft.capabilities.includes(ability.value) }"><input type="checkbox" role="switch" :aria-label="ability.label" :checked="draft.capabilities.includes(ability.value)" @change="toggleCapability(ability.value, $event.target.checked)" /><Icon v-if="draft.capabilities.includes(ability.value)" name="check" :size="16" />{{ ability.label }}</label></div>
      </fieldset>
    </div>

    <button class="model-advanced__toggle" type="button" :aria-expanded="advancedOpen" @click="advancedOpen = !advancedOpen">
      <span>高级</span>
      <Icon class="model-advanced__chevron" :class="{ 'is-open': advancedOpen }" name="down" :size="16" />
    </button>
    <div class="model-advanced" :class="{ 'is-open': advancedOpen }" :inert="advancedOpen ? undefined : true" :aria-hidden="!advancedOpen">
      <div class="model-advanced__inner">
        <div class="model-edit__grid">
          <Field caption="最大输出" label="最大输出" type="number" min="1" step="1000" v-model="draft.maxOutput" placeholder="默认（不限）"><template #trailing><span class="model-advanced__unit">tokens</span></template></Field>
          <Field caption="随机种子" label="随机种子" type="number" min="0" step="1" v-model="draft.seed" placeholder="默认" />
          <Field caption="温度" label="温度" type="number" min="0" max="2" step="0.1" v-model="draft.temperature" placeholder="默认" />
          <Field caption="Top P" label="Top P" type="number" min="0" max="1" step="0.01" v-model="draft.topP" placeholder="默认" />
        </div>
        <Field caption="其他请求参数（JSON）" label="其他请求参数（JSON）" multiline :rows="5" v-model="bodyText" placeholder='{"top_k": 40, "stop": ["..."]}' />
      </div>
    </div>
    <p v-if="error" class="model-edit__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/providers/ModelConfigEditor.scss"></style>
