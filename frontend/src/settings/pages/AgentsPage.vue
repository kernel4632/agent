<!--
智能体设置页：默认是智能体列表，点一行进入该智能体的编辑页。
列表读 /agent/list 的完整目录；编辑写回 draft.agentDefinitions，保存仍由设置页自动完成。
内置智能体也可以覆盖，删除覆盖就恢复内置默认；自定义智能体删除后从配置里移除。
调用示例：<AgentsPage :draft="draft" :detail="detail" @open-detail="..." @close-detail="..." @update-detail-title="..." />
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { KimaCheckboxGroup, KimaSelect } from '../../ui/index.js'
import { AppIcon, Button, Field, Switch } from '../../ui/index.js'
import { store } from '../../store.js'

const props = defineProps({
  draft: { type: Object, required: true },
  detail: { type: Object, default: null },
})
const emit = defineEmits(['open-detail', 'close-detail', 'update-detail-title'])

const rows = computed(() => {
  const catalog = store.config.agents || []
  const definitions = props.draft.agentDefinitions || {}
  const names = new Set([...catalog.map(agent => agent.name), ...Object.keys(definitions)])
  return [...names].map(name => {
    const item = catalog.find(agent => agent.name === name)
    return {
      ...(item || { name, label: name, description: '', readOnly: false }),
      ...(definitions[name] || {}),
      name,
      builtin: item?.builtin === true,
    }
  })
})

const selected = computed(() => props.detail ? rows.value.find(agent => agent.name === props.detail.id) ?? null : null)
const modelOptions = computed(() => {
  const options = [{ value: '', label: '沿用会话模型' }]
  for (const provider of props.draft.providers || []) {
    for (const model of provider.models || []) {
      const id = typeof model === 'string' ? model : model?.id || model?.name
      if (id) options.push({ value: `${provider.name}/${id}`, label: `${provider.name} / ${id}` })
    }
  }
  return options
})
const toolOptions = computed(() => (props.draft.tools || []).map(tool => ({ value: tool.name, label: tool.title || tool.name })))
const allTools = computed(() => selected.value?.tools == null)
const permissionText = ref('')
const permissionError = ref('')

function openAgent(agent) {
  emit('open-detail', { id: agent.name, title: agent.label || agent.name })
}

function addAgent() {
  let number = Object.keys(props.draft.agentDefinitions || {}).length + 1
  while (props.draft.agentDefinitions?.[`custom-${number}`]) number += 1
  const name = `custom-${number}`
  props.draft.agentDefinitions = { ...(props.draft.agentDefinitions || {}), [name]: { label: '新智能体', description: '', instructions: '' } }
  emit('open-detail', { id: name, title: '新智能体' })
}

function patch(fields) {
  if (!props.detail) return
  props.draft.agentDefinitions = {
    ...(props.draft.agentDefinitions || {}),
    [props.detail.id]: { ...(props.draft.agentDefinitions?.[props.detail.id] || {}), ...fields },
  }
  if (fields.label !== undefined) emit('update-detail-title', fields.label)
}

function patchLabel(value) {
  patch({ label: value })
}

function patchModel(value) {
  if (!value) {
    patch({ model: null })
    return
  }
  const index = value.indexOf('/')
  patch({ model: { provider: value.slice(0, index), model: value.slice(index + 1) } })
}

function patchAllTools(value) {
  patch({ tools: value ? null : toolOptions.value.map(tool => tool.value) })
}

function patchTools(values) {
  patch({ tools: values })
}

function resetAgent() {
  const definitions = { ...(props.draft.agentDefinitions || {}) }
  delete definitions[props.detail.id]
  props.draft.agentDefinitions = definitions
  emit('close-detail')
}

watch(() => props.detail?.id, () => {
  permissionText.value = JSON.stringify(selected.value?.permission || {}, null, 2)
  permissionError.value = ''
}, { immediate: true })

function patchPermission(text) {
  permissionText.value = text
  try {
    const parsed = JSON.parse(text || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('必须是 JSON 对象')
    permissionError.value = ''
    patch({ permission: Object.keys(parsed).length ? parsed : null })
  } catch (error) {
    permissionError.value = `权限 JSON 有问题：${error.message}`
  }
}
</script>

<template>
  <section v-if="!detail" class="agents-page" aria-label="智能体">
    <header class="agents-head">
      <p>每个智能体有自己的提示词、模型、工具和权限；切换时只改这次会话的运行方式。</p>
      <Button @click="addAgent"><AppIcon name="plus" :size="18" />新建智能体</Button>
    </header>

    <div v-if="rows.length" class="agents-card">
      <Button
        v-for="agent in rows"
        :key="agent.name"
        variant="plain"
        class="agent-row"
        @click="openAgent(agent)"
      >
        <span class="agent-row__icon" aria-hidden="true"><AppIcon :name="agent.name === 'ask' ? 'chat' : agent.readOnly ? 'eye' : 'code'" :size="20" /></span>
        <span class="agent-row__copy">
          <strong>{{ agent.label || agent.name }}</strong>
          <small>{{ agent.description || '没有说明' }}</small>
        </span>
        <span class="agent-row__badge">{{ agent.builtin === false ? '自定义' : '内置' }}</span>
        <AppIcon name="arrow" :size="16" class="agent-row__arrow" aria-hidden="true" />
      </Button>
    </div>
    <p v-else class="agents-empty">还没有可用的智能体。</p>
  </section>

  <section v-else-if="selected" class="agent-detail" aria-label="智能体设置">
    <header class="agent-detail__head">
      <span class="agent-detail__icon" aria-hidden="true"><AppIcon :name="selected.name === 'ask' ? 'chat' : selected.readOnly ? 'eye' : 'code'" :size="22" /></span>
      <div>
        <h3>{{ selected.label || selected.name }}</h3>
        <p>{{ selected.builtin === false ? '自定义智能体' : '内置智能体' }} · {{ selected.name }}</p>
      </div>
    </header>

    <div class="agent-form">
      <Field caption="名称" :model-value="selected.label || ''" @update:model-value="patchLabel" />
      <Field caption="说明" :model-value="selected.description || ''" @update:model-value="patch({ description: $event })" />
      <Field
        caption="角色说明"
        multiline
        :rows="5"
        :model-value="selected.instructions || ''"
        @update:model-value="patch({ instructions: $event })"
      />
      <p class="agent-hint">追加在全局系统提示词后面，排在项目规则之前。</p>

      <div class="agent-field">
        <span class="agent-field__label">模型</span>
        <KimaSelect
          label="模型"
          :model-value="selected.model ? `${selected.model.provider}/${selected.model.model}` : ''"
          :items="modelOptions"
          @update:model-value="patchModel"
        />
      </div>

      <div class="agent-switch-row">
        <div>
          <strong>只读</strong>
          <small>去掉所有能改文件和执行命令的工具</small>
        </div>
        <Switch hide-label :model-value="selected.readOnly === true" label="只读" @update:model-value="patch({ readOnly: $event })" />
      </div>

      <div class="agent-switch-row">
        <div>
          <strong>全部工具</strong>
          <small>关闭后只给下面勾选的工具；new_task 也要单独勾选</small>
        </div>
        <Switch hide-label :model-value="allTools" label="全部工具" @update:model-value="patchAllTools" />
      </div>

      <div v-if="!allTools" class="agent-field">
        <span class="agent-field__label">工具</span>
        <KimaCheckboxGroup
          class="agent-tools"
          label="工具"
          :options="toolOptions"
          :model-value="selected.tools || []"
          @update:model-value="patchTools"
        />
      </div>

      <Field
        caption="权限覆盖 JSON"
        multiline
        :rows="5"
        :model-value="permissionText"
        :error="permissionError"
        @update:model-value="patchPermission"
      />
      <p class="agent-hint">写法和全局 permission 相同；留空表示沿用全局规则。</p>

      <footer class="agent-actions">
        <Button variant="danger" @click="resetAgent">{{ selected.builtin === false ? '删除智能体' : '恢复内置默认' }}</Button>
      </footer>
    </div>
  </section>

  <div v-else class="agent-missing">
    <p>这个智能体已经不存在了。</p>
    <Button @click="emit('close-detail')">返回智能体列表</Button>
  </div>
</template>

<style scoped lang="scss">
.agents-page { display: flex; flex-direction: column; gap: 16px; }
.agents-head { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.agents-head p { max-width: 620px; margin: 0; color: var(--la-muted); font-size: 14px; line-height: 22px; }
.agents-card { overflow: hidden; border-radius: 24px; background: var(--la-layer-01); box-shadow: 0 1px 2px rgba(0, 0, 0, .08); }
.agent-row {
  display: flex;
  width: 100%;
  min-height: 84px;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--la-text);
  text-align: left;
  cursor: pointer;
}
.agent-row + .agent-row { border-top: .5px solid var(--la-line); }
.agent-row:hover { background: var(--la-hover); }
.agent-row:focus-visible { position: relative; z-index: 1; outline-offset: -2px; }
.agent-row__icon {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  place-items: center;
  border-radius: 14px;
  background: color-mix(in srgb, var(--la-accent) 16%, transparent);
  color: var(--la-accent);
}
.agent-row__copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.agent-row__copy strong { overflow: hidden; color: var(--la-text); font-size: 16px; font-weight: 600; line-height: 24px; text-overflow: ellipsis; white-space: nowrap; }
.agent-row__copy small { overflow: hidden; color: var(--la-muted); font-size: 13px; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
.agent-row__badge { flex: none; padding: 3px 9px; border-radius: 999px; background: var(--la-layer-02); color: var(--la-muted); font-size: 12px; line-height: 18px; }
.agent-row__arrow { flex: none; color: var(--la-muted); }
.agents-empty { margin: 0; padding: 40px 20px; border-radius: 24px; background: var(--la-layer-01); color: var(--la-muted); text-align: center; font-size: 14px; }

.agent-detail { display: grid; gap: 20px; }
.agent-detail__head { display: flex; align-items: center; gap: 16px; padding: 20px; border-radius: 20px; background: var(--la-layer-01); }
.agent-detail__icon { display: grid; width: 48px; height: 48px; flex: none; place-items: center; border-radius: 15px; background: color-mix(in srgb, var(--la-accent) 16%, transparent); color: var(--la-accent); }
.agent-detail__head h3 { margin: 0; color: var(--la-text); font-size: 18px; font-weight: 600; line-height: 26px; }
.agent-detail__head p { margin: 2px 0 0; color: var(--la-muted); font-size: 13px; line-height: 20px; }
.agent-form { display: flex; flex-direction: column; gap: 24px; padding: 24px; border-radius: 20px; background: var(--la-layer-01); }
.agent-field { display: grid; gap: 8px; }
.agent-field__label { color: var(--kima-color-on-surface-variant); font-size: 14px; font-weight: 500; line-height: 20px; }
.agent-hint { margin: -16px 0 0; color: var(--la-muted); font-size: 13px; line-height: 20px; }
.agent-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.agent-switch-row strong { display: block; color: var(--la-text); font-size: 15px; line-height: 22px; }
.agent-switch-row small { display: block; margin-top: 2px; color: var(--la-muted); font-size: 13px; line-height: 20px; }
.agent-tools { max-height: 360px; overflow-y: auto; padding: 8px 12px; border-radius: 16px; background: var(--la-layer-02); }
.agent-actions { padding-top: 20px; border-top: .5px solid var(--la-line); }
.agent-missing { display: grid; justify-items: start; gap: 16px; padding: 24px; border-radius: 20px; background: var(--la-layer-01); }
.agent-missing p { margin: 0; color: var(--la-muted); font-size: 14px; }

@media (max-width: 767px) {
  .agents-head { align-items: flex-start; flex-direction: column; gap: 12px; }
  .agent-row { min-height: 80px; padding: 12px 16px; }
  .agent-row__badge { display: none; }
  .agent-form { padding: 20px; }
  .agent-switch-row { align-items: flex-start; }
}
</style>
