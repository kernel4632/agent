<!--
步骤操作：每个模型步骤左侧的窄条。点击后从左侧覆盖整个步骤，只给“回退”和“分支”两个动作。
窄条不接触正文，右键和长按都留给浏览器原生菜单；两个动作都先弹确认，回退确认里可以决定是否同时恢复文件。
调用示例：
<StepActions :rollback-target="firstMessage" :fork-target="lastMessage" :running="running"
  label="步骤操作" @rollback="rollbackStep" @fork="forkStep" />
-->
<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import Button from '../../ui/Button.vue'
import Checkbox from '../../ui/Checkbox.vue'
import Dialog from '../../ui/Dialog.vue'
import Icon from '../../ui/Icon.vue'

const props = defineProps({
  rollbackTarget: { type: Object, default: null }, // 回退从这一条消息开始，通常是步骤的第一条消息
  forkTarget: { type: Object, default: null },     // 分支保留到这一条消息，通常是步骤的最后一条消息
  running: Boolean,
  label: { type: String, default: '步骤操作' },
})
const emit = defineEmits(['rollback', 'fork'])

const open = ref(false)
const confirm = ref('') // '' | 'rollback' | 'fork'
const restoreFiles = ref(true)
const panel = ref(null)
const rail = ref(null)

function closePanel() {
  open.value = false
}

function toggle() {
  if (!props.rollbackTarget && !props.forkTarget) return
  open.value = !open.value
}

function askRollback() {
  if (!props.rollbackTarget?.id) return
  closePanel()
  restoreFiles.value = true
  confirm.value = 'rollback'
}

function askFork() {
  if (!props.forkTarget?.id) return
  closePanel()
  confirm.value = 'fork'
}

function doRollback() {
  confirm.value = ''
  emit('rollback', { message: props.rollbackTarget, files: restoreFiles.value })
}

function doFork() {
  confirm.value = ''
  emit('fork', props.forkTarget)
}

function onOutside(event) {
  if (!open.value) return
  if (panel.value?.contains(event.target) || rail.value?.contains(event.target)) return
  closePanel()
}

function onKeydown(event) {
  if (event.key === 'Escape' && open.value) closePanel()
}

watch(open, value => {
  if (value) {
    document.addEventListener('pointerdown', onOutside)
    document.addEventListener('keydown', onKeydown)
  } else {
    document.removeEventListener('pointerdown', onOutside)
    document.removeEventListener('keydown', onKeydown)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutside)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="step-actions">
    <button
      ref="rail"
      type="button"
      class="step-actions__rail"
      :aria-label="label"
      :aria-expanded="open"
      :disabled="!rollbackTarget && !forkTarget"
      @click.stop="toggle"
    ><span class="step-actions__grip" aria-hidden="true"></span></button>

    <Transition name="step-actions-panel">
      <div v-if="open" ref="panel" class="step-actions__panel" role="menu" :aria-label="label" @click.stop>
        <div class="step-actions__items">
          <button type="button" class="step-actions__item" :disabled="!rollbackTarget?.id" @click="askRollback">
            <Icon name="undo" :size="17" />
            <span>回退到此步骤之前</span>
          </button>
          <button type="button" class="step-actions__item" :disabled="!forkTarget?.id" @click="askFork">
            <Icon name="branch" :size="17" />
            <span>从此步骤创建分支</span>
          </button>
          <button type="button" class="step-actions__close" aria-label="关闭步骤操作" @click="closePanel">
            <Icon name="close" :size="16" />
          </button>
        </div>
        <p v-if="running" class="step-actions__hint">当前任务会先停止</p>
      </div>
    </Transition>

    <Dialog
      v-if="confirm === 'rollback'"
      :open="true"
      label="回退到此步骤之前"
      description="此步骤及之后的内容会从对话中移除。"
      @update:open="value => { if (!value) confirm = '' }"
    >
      <p class="step-actions__summary">回退后，可以发送新消息继续；回退期间不会删除工作区里的文件，除非你勾选下面的选项。</p>
      <Checkbox v-model="restoreFiles" label="同时把文件改回这一步之前" />
      <p class="step-actions__hint">{{ restoreFiles ? '文件会和对话一起退回。' : '只退对话，工作区里的文件保持现在的样子。' }}</p>
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
      <p class="step-actions__summary">分支创建后会打开新的会话，你可以从那里继续，不会影响当前对话。</p>
      <template #footer>
        <Button @click="confirm = ''">取消</Button>
        <Button variant="primary" @click="doFork">创建分支</Button>
      </template>
    </Dialog>
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/conversation/StepActions.scss"></style>
