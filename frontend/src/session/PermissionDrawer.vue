<!--
自动批准底部抽屉：用 KIMA 列表承载五个分类，每行是一张可点的卡片。
卡片自带图标、说明和勾选标记；不再把文字和开关拆成两列。
调用示例：<PermissionDrawer :open="open" :auto-approve="session.settings.autoApprove" @toggle="Session.toggleAutoApprove(session.id, $event)" />
-->
<script setup>
import { computed } from 'vue'
import { KimaList } from '@kernel4632/kima'
import { AppIcon, ChoiceCard, Sheet } from '../ui/index.js'
import { AUTO_APPROVE_KINDS } from '../commands/session.js'

const props = defineProps({
  open: Boolean,
  autoApprove: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:open', 'toggle'])

const rows = computed(() => AUTO_APPROVE_KINDS.map(item => ({
  id: item.kind,
  icon: item.icon,
  title: item.label,
  hint: item.hint,
  on: Boolean(props.autoApprove?.[item.kind]),
})))
const count = computed(() => rows.value.filter(row => row.on).length)
</script>

<template>
  <Sheet
    :open="open"
    label="自动批准"
    description="选中的操作直接执行，不再逐次询问。"
    :width="608"
    @update:open="emit('update:open', $event)"
  >
    <div class="permission-drawer">
      <div class="permission-drawer__meta">
        <span>按类别放行</span>
        <span class="permission-drawer__count" :class="{ 'is-on': count > 0 }">已开启 {{ count }} / {{ rows.length }}</span>
      </div>

      <KimaList class="permission-drawer__list" :items="rows" label="自动批准分类">
        <template #item="{ item }">
          <ChoiceCard
            role="checkbox"
            :selected="item.on"
            :icon="item.icon"
            :title="item.title"
            :hint="item.hint"
            @select="emit('toggle', item.id)"
          />
        </template>
      </KimaList>

      <p class="permission-drawer__note">
        <AppIcon name="info" :size="15" />
        <span><code>.agentignore</code> 仍然生效；子任务内部也按类别判断。</span>
      </p>
    </div>
  </Sheet>
</template>

<style scoped lang="scss">
.permission-drawer { display: grid; width: 100%; max-width: 560px; gap: 14px; margin: 0 auto; padding-bottom: 8px; }

.permission-drawer__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 2px;
  color: var(--la-muted);
  font-size: 12.5px;
  letter-spacing: .02em;
}

.permission-drawer__count {
  flex: none;
  padding: 3px 10px;
  border: .5px solid var(--la-line);
  border-radius: 999px;
  color: var(--la-secondary);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;

  &.is-on {
    border-color: var(--la-accent-border);
    color: var(--la-accent);
  }
}

/* KIMA 列表默认带 20px 行内边距和底色；这里把行还原成透明，
   圆角、底色和点击面都交给里面的 ChoiceCard。 */
.permission-drawer__list :deep(.kima-list) { gap: 8px; }
.permission-drawer__list :deep(.kima-list__item) {
  min-height: 0;
  padding: 0;
  border-radius: 16px;
  background: transparent;
}

.permission-drawer__note {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  padding: 0 2px;
  color: var(--la-muted);
  font-size: 12.5px;
  line-height: 18px;

  code { font-family: var(--la-font-mono); }
}
</style>
