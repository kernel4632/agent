<!--
权限控制面板：只放自动批准分类，和 Roo Code 的 auto-approve 菜单对应。
新对话页改的是待创建会话的默认值；已有会话直接写回当前会话设置。
调用示例：
<PermissionSheet :open="open" :auto-approve="session.settings.autoApprove" @update:open="open = $event" @toggle="Session.toggleAutoApprove(session.id, $event)" />
-->
<script setup>
import { KimaChip } from '@kernel4632/kima'
import { AppIcon, Sheet } from '../ui/index.js'
import { AUTO_APPROVE_KINDS } from '../commands/session.js'

defineProps({
  open: Boolean,
  autoApprove: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:open', 'toggle'])
</script>

<template>
  <Sheet :open="open" label="权限控制" @update:open="emit('update:open', $event)">
    <div class="permission-sheet">
      <p class="permission-sheet__hint">打开某一类后，这类操作会跳过每次询问；没有列出的危险操作仍然会先问你。</p>
      <div class="permission-sheet__chips">
        <KimaChip
          v-for="item in AUTO_APPROVE_KINDS"
          :key="item.kind"
          selectable
          :label="item.label"
          :model-value="!!autoApprove?.[item.kind]"
          :title="`自动批准「${item.label}」：${item.hint}`"
          @change="emit('toggle', item.kind)"
        >
          <AppIcon :name="item.icon" :size="16" />{{ item.label }}
        </KimaChip>
      </div>
      <p class="permission-sheet__note">项目里的 <code>.agentignore</code> 规则仍然生效，自动批准不会绕过它。</p>
    </div>
  </Sheet>
</template>

<style scoped lang="scss">
.permission-sheet { display: grid; max-width: 560px; gap: 16px; margin: 0 auto; padding-bottom: 8px; }
.permission-sheet__hint { margin: 0; color: var(--la-secondary); font-size: 14px; line-height: 22px; }
.permission-sheet__chips { display: flex; flex-wrap: wrap; gap: 8px; }
.permission-sheet__note { margin: 0; color: var(--la-muted); font-size: 13px; line-height: 20px; }
.permission-sheet__note code { font-family: var(--la-font-mono); }
</style>
