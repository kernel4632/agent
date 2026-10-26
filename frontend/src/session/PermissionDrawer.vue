<!--
自动批准底部抽屉：用 KIMA 多选列表，不把文字和开关拆成两列。
列表本身就是多选控件，选中行由 KIMA 负责背景和键盘状态。
调用示例：<PermissionDrawer :open="open" :auto-approve="session.settings.autoApprove" @toggle="Session.toggleAutoApprove(session.id, $event)" />
-->
<script setup>
import { computed } from 'vue'
import { KimaListbox } from '@kernel4632/kima'
import { Sheet } from '../ui/index.js'
import { AUTO_APPROVE_KINDS } from '../commands/session.js'

const props = defineProps({
  open: Boolean,
  autoApprove: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:open', 'toggle'])

const options = AUTO_APPROVE_KINDS.map(item => ({ value: item.kind, label: item.label }))
const selected = computed(() => AUTO_APPROVE_KINDS
  .filter(item => props.autoApprove?.[item.kind])
  .map(item => item.kind))

function update(values) {
  const next = new Set(values)
  for (const item of AUTO_APPROVE_KINDS) {
    if (next.has(item.kind) !== Boolean(props.autoApprove?.[item.kind])) emit('toggle', item.kind)
  }
}
</script>

<template>
  <Sheet :open="open" label="自动批准" @update:open="emit('update:open', $event)">
    <div class="permission-drawer__body">
      <p class="permission-drawer__lead">选中某一类后，这类操作会跳过每次询问；<code>.agentignore</code> 仍然生效，危险操作仍会先问你。</p>
      <KimaListbox
        multiple
        label="自动批准分类"
        :options="options"
        :model-value="selected"
        @update:model-value="update"
      />
      <p class="permission-drawer__note">可以多选；再点一次取消。</p>
    </div>
  </Sheet>
</template>

<style scoped lang="scss">
.permission-drawer__body { display: grid; max-width: 560px; gap: 16px; margin: 0 auto; padding-bottom: 8px; }
.permission-drawer__lead { margin: 0; color: var(--la-secondary); font-size: 14px; line-height: 22px; }
.permission-drawer__lead code { font-family: var(--la-font-mono); }
.permission-drawer__note { margin: 0; color: var(--la-muted); font-size: 13px; line-height: 20px; }
.permission-drawer__body :deep(.kima-listbox) { padding: 4px; border-radius: 16px; }
.permission-drawer__body :deep(.kima-listbox__option) { min-height: 52px; padding-inline: 16px; border-radius: 12px; font-size: 15px; }
/* 多选列表默认只靠底色表示选中；补一个勾，方向键切换时也更容易看见。 */
.permission-drawer__body :deep(.kima-listbox__option[aria-selected="true"])::after { content: '✓'; color: var(--kima-color-primary); font-size: 16px; font-weight: 600; }
</style>
