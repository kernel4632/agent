<!--
全局唯一的步骤操作浮层。
时间线里只有这一份；鼠标靠近/点击某个步骤时，父组件把它移动到该步骤左侧，点开后给回退和分支。
两个动作都先确认；回退确认里可以决定是否同时恢复文件。右键和长按不经过这里，由浏览器原生处理。
调用示例：
<StepActions :visible="stepAction.visible" :left="stepAction.left" :top="stepAction.top"
  :rollback-id="..." :fork-id="..." :running="running" @rollback="..." @fork="..." />
-->
<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Button from '../../ui/Button.vue'
import Checkbox from '../../ui/Checkbox.vue'
import Dialog from '../../ui/Dialog.vue'
import Icon from '../../ui/Icon.vue'

const props = defineProps({
  visible: Boolean,
  left: { type: Number, default: 0 },
  top: { type: Number, default: 0 },
  rollbackId: { type: String, default: '' }, // 回退从这个步骤的第一条消息开始
  forkId: { type: String, default: '' },     // 分支保留到这个步骤的最后一条消息
  running: Boolean,
  label: { type: String, default: '步骤操作' },
})
const emit = defineEmits(['rollback', 'fork', 'busy'])

const open = ref(false)
const confirm = ref('') // '' | 'rollback' | 'fork'
const restoreFiles = ref(true)
const root = ref(null)

function closePanel() {
  open.value = false
}

function toggle() {
  if (!props.rollbackId && !props.forkId) return
  open.value = !open.value
}

function askRollback() {
  if (!props.rollbackId) return
  closePanel()
  restoreFiles.value = true
  confirm.value = 'rollback'
}

function askFork() {
  if (!props.forkId) return
  closePanel()
  confirm.value = 'fork'
}

function doRollback() {
  confirm.value = ''
  emit('rollback', { id: props.rollbackId, files: restoreFiles.value })
}

function doFork() {
  confirm.value = ''
  emit('fork', props.forkId)
}

function onOutside(event) {
  if (!open.value || root.value?.contains(event.target)) return
  closePanel()
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    if (open.value) closePanel()
    else if (confirm.value) confirm.value = ''
  }
}

watch(open, value => {
  if (value) document.addEventListener('pointerdown', onOutside)
  else document.removeEventListener('pointerdown', onOutside)
})
// 浮层跟着鼠标换了步骤时，旧面板不能继续指向旧目标。
watch(() => props.rollbackId, () => { if (open.value) closePanel() })
watch(() => props.visible, value => { if (!value) { closePanel(); confirm.value = '' } })
watch([open, confirm], ([panelOpen, mode]) => emit('busy', panelOpen || Boolean(mode)))
watch(() => props.forkId, () => { if (open.value) closePanel() })

onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside))
onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Transition name="step-actions-float">
    <div
      v-if="visible"
      ref="root"
      class="step-actions-float"
      :style="{ left: `${left}px`, top: `${top}px` }"
    >
      <button
        type="button"
        class="step-actions-float__trigger"
        :aria-label="label"
        :aria-expanded="open"
        :disabled="!rollbackId && !forkId"
        @click.stop="toggle"
      >
        <Icon name="layers" :size="17" />
        <Icon name="more" :size="15" />
      </button>

      <Transition name="step-actions-panel">
        <div v-if="open" class="step-actions-float__panel" role="menu" :aria-label="label" @click.stop>
          <button type="button" class="step-actions-float__item" :disabled="!rollbackId" @click="askRollback">
            <Icon name="undo" :size="17" />
            <span>回退到此步骤之前</span>
          </button>
          <button type="button" class="step-actions-float__item" :disabled="!forkId" @click="askFork">
            <Icon name="branch" :size="17" />
            <span>从此步骤创建分支</span>
          </button>
          <button type="button" class="step-actions-float__close" aria-label="关闭步骤操作" @click="closePanel">
            <Icon name="close" :size="16" />
          </button>
          <p v-if="running" class="step-actions-float__hint">当前任务会先停止</p>
        </div>
      </Transition>
    </div>
  </Transition>

  <Dialog
    v-if="confirm === 'rollback'"
    :open="true"
    label="回退到此步骤之前"
    description="此步骤及之后的内容会从对话中移除。"
    @update:open="value => { if (!value) confirm = '' }"
  >
    <p class="step-actions-float__summary">回退后，可以发送新消息继续；回退期间不会删除工作区里的文件，除非你勾选下面的选项。</p>
    <Checkbox v-model="restoreFiles" label="同时把文件改回这一步之前" />
    <p class="step-actions-float__hint">{{ restoreFiles ? '文件会和对话一起退回。' : '只退对话，工作区里的文件保持现在的样子。' }}</p>
    <template #footer>
      <Button @click="confirm = ''">取消</Button>
      <Button variant="primary" @click="doRollback">确认回退</Button>
    </template>
  </Dialog>

  <Dialog
    v-if="confirm === 'fork'"
    :open="true"
    label="从此步骤创建分支"
    description="原对话保持不变，分支会复制到这一步骤为止。"
    @update:open="value => { if (!value) confirm = '' }"
  >
    <p class="step-actions-float__summary">分支创建后会打开新的会话，你可以从那里继续，不会影响当前对话。</p>
    <template #footer>
      <Button @click="confirm = ''">取消</Button>
      <Button variant="primary" @click="doFork">创建分支</Button>
    </template>
  </Dialog>
</template>

<style scoped lang="scss" src="../../styles/components/conversation/StepActions.scss"></style>
