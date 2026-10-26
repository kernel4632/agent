<!--
自动批准底部抽屉：和 Roo Code 的 auto-approve 一样，只放开关，文字和开关都在 KIMA Switch 里。
权限入口和模式入口分开，自动批准不再塞进右侧对话设置。
调用示例：<PermissionDrawer :open="open" :auto-approve="session.settings.autoApprove" @toggle="Session.toggleAutoApprove(session.id, $event)" />
-->
<script setup>
import { Switch, Sheet } from '../ui/index.js'
import { AUTO_APPROVE_KINDS } from '../commands/session.js'

defineProps({
  open: Boolean,
  autoApprove: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:open', 'toggle'])
</script>

<template>
  <Sheet :open="open" label="自动批准" @update:open="emit('update:open', $event)">
    <div class="permission-drawer__body">
      <p class="permission-drawer__lead">打开某一类后，这类操作会跳过每次询问；<code>.agentignore</code> 仍然生效，没有列出的危险操作仍会先问你。</p>
      <div class="permission-drawer__list">
        <Switch
          v-for="item in AUTO_APPROVE_KINDS"
          :key="item.kind"
          :model-value="!!autoApprove?.[item.kind]"
          :label="item.label"
          @update:model-value="emit('toggle', item.kind)"
        />
      </div>
    </div>
  </Sheet>
</template>

<style scoped lang="scss">
.permission-drawer__body { display: grid; max-width: 560px; gap: 16px; margin: 0 auto; padding-bottom: 8px; }
.permission-drawer__lead { margin: 0; color: var(--la-secondary); font-size: 14px; line-height: 22px; }
.permission-drawer__lead code { font-family: var(--la-font-mono); }
.permission-drawer__list { display: flex; flex-direction: column; gap: 4px; }
.permission-drawer__list :deep(.kima-switch) { width: 100%; min-height: 52px; padding: 0 16px; border-radius: 14px; background: var(--la-layer-01); }
</style>
