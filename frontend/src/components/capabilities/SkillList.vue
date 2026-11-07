<!--
技能页：本应用自己的技能可以直接改；从其他软件识别到的目录默认只识别，启用后才生效。
列表、正文弹窗和编辑弹窗共用同一份 /skill/list 数据；保存或启停后重新读取。
调用示例：<SkillList :draft="draft" />
-->
<script setup>
import { computed, onMounted, ref } from 'vue'
import Button from '../../ui/Button.vue'
import Dialog from '../../ui/Dialog.vue'
import Field from '../../ui/Field.vue'
import Icon from '../../ui/Icon.vue'
import Markdown from '../../ui/Markdown.vue'
import SelectButton from '../../ui/SelectButton.vue'      // 自有选择控件，支持半选
import Switch from '../../ui/Switch.vue'
import SkillEditor from './SkillEditor.vue'
import { Skills, externalRoots, sourceLabel } from "../../features/skills.js"

const data = ref({ skills: [], roots: [], state: { sources: [], disabled: [] } })
const loading = ref(true)
const busy = ref('')
const query = ref('')
const reader = ref(null)
const deleting = ref(null)
const sourcePath = ref('')
const sourceError = ref('')
const editor = ref({ open: false, skill: null })

const skills = computed(() => data.value.skills || [])
const roots = computed(() => externalRoots(data.value.roots))
const visibleSkills = computed(() => {
  const term = query.value.trim().toLowerCase()
  if (!term) return skills.value
  return skills.value.filter(skill => skill.name.toLowerCase().includes(term) || skill.description.toLowerCase().includes(term))
})

// --- 批量选择：键是技能名，只统计当前可见且未启用的项参与批量开启 ---
const checked = ref({})
const bulkBusy = ref(false)                                // 批量开启进行中
const selectableSkills = computed(() => visibleSkills.value.filter(skill => !skill.enabled))
const selectedNames = computed(() => selectableSkills.value.filter(skill => checked.value[skill.name]).map(skill => skill.name))
const allChecked = computed(() => selectableSkills.value.length > 0 && selectableSkills.value.every(skill => checked.value[skill.name]))
const someChecked = computed(() => selectableSkills.value.some(skill => checked.value[skill.name]))
const bulkState = computed(() => ({
  modelValue: allChecked.value,
  indeterminate: !allChecked.value && someChecked.value,
  disabled: !selectableSkills.value.length,
}))

function toggleAll(value) {
  const next = {}
  for (const skill of selectableSkills.value) next[skill.name] = value
  checked.value = next
}

function toggleOne(name, value) {
  checked.value = { ...checked.value, [name]: value }
}

// 批量开启：先落盘草稿，再逐项提交，成功后同步列表与勾选状态。
async function bulkEnable() {
  const names = selectedNames.value
  if (!names.length) return
  bulkBusy.value = true
  try {
    const results = await Skills.toggleMany(names, true)   // 命令层已负责逐项提交
    for (const skill of skills.value) {                    // 响应后同步草稿里的开关状态，防回跳
      const result = results.find(item => item?.name === skill.name)
      if (result) {
        skill.enabled = result.enabled
        checked.value = { ...checked.value, [skill.name]: false }
      }
    }
  } finally {
    bulkBusy.value = false
  }
}

async function load() {
  loading.value = true
  const result = await Skills.load()
  if (result) data.value = result
  loading.value = false
}
onMounted(load)

async function toggleSkill(skill, enabled) {
  busy.value = skill.name
  const result = await Skills.toggle(skill.name, enabled)
  busy.value = ''
  if (!result) return
  skill.enabled = result.enabled
}

async function toggleRoot(root, enabled) {
  busy.value = `root:${root.path}`
  const result = await Skills.source(root.path, enabled)
  busy.value = ''
  if (result) await load()
}

async function showSkill(skill) {
  busy.value = skill.name
  const full = await Skills.read(skill.name)
  busy.value = ''
  if (full) reader.value = full
}

function openNew() {
  editor.value = { open: true, skill: null }
}

function openEdit(skill) {
  reader.value = null
  editor.value = { open: true, skill }
}

// 外部技能只能读，复制一份到本应用目录后再改；同名时先加一个后缀，避免覆盖现有技能。
function copySkill() {
  const skill = reader.value
  if (!skill) return
  const taken = skills.value.some(item => item.editable && item.name === skill.name)
  editor.value = {
    open: true,
    skill: {
      name: taken ? `${skill.name}-copy` : skill.name,
      description: skill.description,
      body: skill.body,
      scope: 'global',
      editable: false,
    },
  }
  reader.value = null
}

async function saveSkill(payload) {
  busy.value = 'editor'
  const saved = await Skills.save(payload)
  busy.value = ''
  if (!saved) return
  editor.value = { open: false, skill: null }
  await load()
}

async function removeSkill() {
  const skill = deleting.value
  if (!skill) return
  busy.value = skill.name
  const result = await Skills.remove(skill.name, skill.scope)
  busy.value = ''
  deleting.value = null
  if (result) await load()
}

async function addSource() {
  sourceError.value = ''
  const path = sourcePath.value.trim()
  if (!path) {
    sourceError.value = '填写一个绝对路径'
    return
  }
  busy.value = 'source:add'
  const result = await Skills.source(path, true)
  busy.value = ''
  if (!result) return
  sourcePath.value = ''
  await load()
}
</script>

<template>
  <section class="skill-page" aria-label="技能">
    <header class="skill-head">
      <p>技能是写在 SKILL.md 里的操作说明。打开表示交给模型，关闭只是从清单里拿掉，文件不动。</p>
    </header>

    <div class="skill-toolbar">
      <Field v-model="query" class="app-search" type="search" label="搜索技能" placeholder="搜索技能" clearable>
        <template #leading><Icon name="search" :size="18" /></template>
      </Field>
      <Button icon variant="tonal" class="app-add-button" label="新建技能" title="新建技能" @click="openNew"><Icon name="plus" :size="24" /></Button>
    </div>

    <p v-if="loading" class="skill-empty">正在读取技能…</p>
    <p v-else-if="!visibleSkills.length" class="skill-empty">
      {{ skills.length ? '没有匹配的技能。' : '还没有技能。新建一个，或在下面启用其他软件的技能目录。' }}
    </p>
    <template v-else>
      <!-- 吸顶批量操作条：全选（半选态）、已选计数、取消选择、批量开启 -->
      <div class="skill-bulk">
        <SelectButton
          :model-value="bulkState.modelValue"
          :indeterminate="bulkState.indeterminate"
          :disabled="bulkState.disabled || bulkBusy"
          label="全选未开启的技能"
          @update:model-value="toggleAll"
        />
        <span class="skill-bulk__count">已选 {{ selectedNames.length }} 项</span>
        <span class="skill-bulk__spacer"></span>
        <Button variant="text" :disabled="!selectedNames.length || bulkBusy" @click="checked = {}">取消选择</Button>
        <Button :disabled="!selectedNames.length || bulkBusy" @click="bulkEnable">
          <Icon name="check" :size="18" />{{ bulkBusy ? '开启中…' : `批量开启 ${selectedNames.length || ''}` }}
        </Button>
      </div>

      <div class="skill-card">
      <div v-for="skill in visibleSkills" :key="skill.name" class="skill-row">
        <SelectButton
          v-if="!skill.enabled"
          :model-value="Boolean(checked[skill.name])"
          :disabled="bulkBusy"
          :label="`选择 ${skill.name}`"
          @update:model-value="toggleOne(skill.name, $event)"
        />
        <span class="skill-row__icon" aria-hidden="true"><Icon name="document" :size="20" /></span>
        <span class="skill-row__copy">
          <strong>{{ skill.name }}</strong>
          <small>{{ skill.description }}</small>
          <span class="skill-row__tags">
            <span class="skill-tag">{{ sourceLabel(skill) }}</span>
            <span v-if="skill.scope === 'project'" class="skill-tag">项目</span>
            <span v-if="!skill.editable" class="skill-tag skill-tag--foreign">只读</span>
            <span v-if="!skill.enabled" class="skill-tag">已关闭</span>
          </span>
        </span>
        <span class="skill-row__actions">
          <Button variant="text" size="small" @click="showSkill(skill)">查看</Button>
          <Button v-if="skill.editable" variant="text" size="small" @click="openEdit(skill)">编辑</Button>
          <Button v-if="skill.editable" variant="text" size="small" @click="deleting = skill">删除</Button>
          <Switch
            :model-value="skill.enabled"
            :label="`${skill.name} 交给模型`"
            :disabled="busy === skill.name"
            hide-label
            @update:model-value="toggleSkill(skill, $event)"
          />
        </span>
      </div>
      </div>
    </template>

    <section class="skill-roots" aria-label="本机技能目录">
      <header class="skill-roots__head">
        <h2>本机识别到的技能目录</h2>
        <p>来自其他软件的技能默认只识别不启用；打开后它的技能会出现在上面的清单里。</p>
      </header>

      <div v-if="roots.length" class="skill-card">
        <div v-for="root in roots" :key="root.id" class="skill-root-row">
          <span class="skill-root-row__icon" aria-hidden="true"><Icon name="folder" :size="20" /></span>
          <span class="skill-root-row__copy">
            <strong>{{ root.label }}</strong>
            <small>{{ root.path }}</small>
            <small>{{ root.skillCount }} 个技能 · {{ root.enabled ? '已启用' : '未启用' }}</small>
          </span>
          <Switch
            :model-value="root.enabled"
            :label="`启用 ${root.label}`"
            :disabled="busy === `root:${root.path}`"
            hide-label
            @update:model-value="toggleRoot(root, $event)"
          />
        </div>
      </div>
      <p v-else class="skill-empty">没有发现其他软件留下的技能目录。</p>

      <form class="skill-source" @submit.prevent="addSource">
        <Field
          caption="手动添加技能目录"
          :model-value="sourcePath"
          placeholder="/Users/yourname/.agents/skills"
          :error="sourceError"
          @update:model-value="sourcePath = $event"
        />
        <Button :disabled="busy === 'source:add'" @click="addSource">启用目录</Button>
      </form>
    </section>

    <SkillEditor
      :open="editor.open"
      :skill="editor.skill"
      :busy="busy === 'editor'"
      @update:open="editor.open = $event"
      @submit="saveSkill"
    />

    <Dialog :open="Boolean(reader)" :label="reader?.name || '技能'" @update:open="reader = $event ? reader : null">
      <div v-if="reader" class="skill-reader">
        <p class="skill-reader__meta">{{ sourceLabel(reader) }} · {{ reader.path }}</p>
        <p class="skill-reader__description">{{ reader.description }}</p>
        <Markdown :content="reader.body" compact />
      </div>
      <template #footer>
        <div class="dialog-actions">
          <Button variant="text" @click="reader = null">关闭</Button>
          <Button v-if="reader?.editable" @click="openEdit(reader)"><Icon name="edit" :size="18" />编辑</Button>
          <Button v-else @click="copySkill"><Icon name="copy" :size="18" />复制到我的技能</Button>
        </div>
      </template>
    </Dialog>

    <Dialog :open="Boolean(deleting)" label="删除技能" @update:open="deleting = $event ? deleting : null">
      <p>删除技能“{{ deleting?.name }}”？它的文件夹会从磁盘上删掉。</p>
      <template #footer>
        <div class="dialog-actions">
          <Button variant="text" @click="deleting = null">取消</Button>
          <Button variant="danger" :disabled="busy === deleting?.name" @click="removeSkill"><Icon name="trash" :size="18" />删除</Button>
        </div>
      </template>
    </Dialog>
  </section>
</template>

<style scoped lang="scss" src="../../styles/components/capabilities/SkillList.scss"></style>
