<!--
技能编辑弹窗：新建或改写本应用自己的技能。
名称只在新建时能改；已有技能改名等于另建一个，避免覆盖别的技能。
调用示例：<SkillEditor :open="editor.open" :skill="editor.skill" :busy="saving" :error="saveError" @update:open="..." @submit="saveSkill" />
-->
<script setup>
import { computed, ref, watch } from 'vue'
import Button from '@app/ui/Button.vue'
import Dialog from '@app/ui/Dialog.vue'
import Field from '@app/ui/Field.vue'
import Select from '@app/ui/Select.vue'

const props = defineProps({
  open: Boolean,
  skill: { type: Object, default: null },
  busy: Boolean,
  error: String,
})
const emit = defineEmits(['update:open', 'submit'])

const form = ref({ name: '', description: '', body: '', scope: 'global' })
const localError = ref('')

// 从外部复制过来的技能没有 editable，名称可以改；已有技能只改正文和说明。
const editing = computed(() => Boolean(props.skill?.editable && props.skill?.name))
const title = computed(() => editing.value ? '编辑技能' : '新建技能')
const scopeOptions = [
  { value: 'global', label: '全局技能（所有会话可用）' },
  { value: 'project', label: '项目技能（当前会话目录）' },
]

watch(() => [props.open, props.skill], () => {
  if (!props.open) return
  form.value = {
    name: props.skill?.name || '',
    description: props.skill?.description || '',
    body: props.skill?.body || '',
    scope: props.skill?.scope === 'project' ? 'project' : 'global',
  }
  localError.value = ''
}, { immediate: true })

function submit() {
  const name = form.value.name.trim()
  const description = form.value.description.trim()
  if (!name) {
    localError.value = '技能名称不能为空'
    return
  }
  if (!description) {
    localError.value = '写一句什么时候用这个技能'
    return
  }
  localError.value = ''
  emit('submit', {
    name,
    description,
    body: form.value.body,
    scope: form.value.scope,
  })
}
</script>

<template>
  <Dialog :open="open" :label="title" @update:open="emit('update:open', $event)">
    <form class="skill-form" @submit.prevent="submit">
      <Field
        caption="技能名称"
        :model-value="form.name"
        :disabled="editing || busy"
        placeholder="review"
        hint="名称会作为文件夹名；中文和空格也可以。"
        @update:model-value="form.name = $event"
      />
      <Field
        caption="什么时候用"
        :model-value="form.description"
        :disabled="busy"
        placeholder="审查改动时用这个"
        @update:model-value="form.description = $event"
      />

      <div v-if="!editing" class="skill-field">
        <span class="skill-field__caption">保存位置</span>
        <Select
          label="保存位置"
          :model-value="form.scope"
          :items="scopeOptions"
          :disabled="busy"
          @update:model-value="form.scope = $event"
        />
      </div>

      <Field
        caption="正文（Markdown）"
        multiline
        :rows="10"
        :model-value="form.body"
        :disabled="busy"
        placeholder="第一步：读 diff。&#10;第二步：……"
        @update:model-value="form.body = $event"
      />

      <p v-if="localError || error" class="skill-form__error" role="alert">{{ localError || error }}</p>

      <footer class="skill-form__actions">
        <Button variant="text" :disabled="busy" @click="emit('update:open', false)">取消</Button>
        <Button variant="primary" :disabled="busy" @click="submit">{{ busy ? '保存中…' : '保存' }}</Button>
      </footer>
    </form>
  </Dialog>
</template>

<style scoped lang="scss" src="../../styles/components/capabilities/SkillEditor.scss"></style>
