<!--
自动批准底部抽屉：选项交给 KIMA Listbox，多选、键盘和 ARIA 都由组件负责。
每行内容用 #option 插槽画成卡片：图标、名称、说明和勾选标记。
调用示例：<PermissionDrawer :open="open" :auto-approve="session.settings.autoApprove" @toggle="Session.toggleAutoApprove(session.id, $event)" />
-->
<script setup>
import { computed } from 'vue'
import { KimaListbox } from '@kernel4632/kima'
import { AppIcon, ChoiceContent, Sheet } from '../ui/index.js'
import { AUTO_APPROVE_KINDS } from '../commands/session.js'

const props = defineProps({
  open: Boolean,
  autoApprove: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:open', 'toggle'])

const options = AUTO_APPROVE_KINDS.map(item => ({
  value: item.kind,
  label: item.label,
  description: item.hint,
  icon: item.icon,
}))
const selected = computed(() => AUTO_APPROVE_KINDS
  .filter(item => props.autoApprove?.[item.kind])
  .map(item => item.kind))
const count = computed(() => selected.value.length)

function update(values) {
  const next = new Set(values)
  for (const item of AUTO_APPROVE_KINDS) {
    if (next.has(item.kind) !== Boolean(props.autoApprove?.[item.kind])) emit('toggle', item.kind)
  }
}
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
        <span class="permission-drawer__count" :class="{ 'is-on': count > 0 }">已开启 {{ count }} / {{ options.length }}</span>
      </div>

      <KimaListbox
        multiple
        label="自动批准分类"
        :options="options"
        :model-value="selected"
        @update:model-value="update"
      >
        <template #option="{ item, selected: on }">
          <ChoiceContent
            :selected="on"
            :icon="item.icon"
            :title="item.label"
            :hint="item.description"
          />
        </template>
      </KimaListbox>

      <p class="permission-drawer__note">
        <AppIcon name="info" :size="15" />
        <span><code>.agentignore</code> 仍然生效；子任务内部也按类别判断。</span>
      </p>
    </div>
  </Sheet>
</template>

<style scoped lang="scss">
.permission-drawer { display: grid; width: 100%; max-width: 560px; gap: 14px; margin: 16px auto 0; padding-bottom: 8px; }

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

/* KIMA Listbox 默认是一整块带底色和 8px 内边距的列表；
   这里把外壳让出来，卡片底色、描边和间距交给每个选项。 */
.permission-drawer :deep(.kima-listbox) {
  padding: 0;
  border-radius: 0;
  background: transparent;
}

.permission-drawer :deep(.kima-listbox__option + .kima-listbox__option) { margin-top: 8px; }

.permission-drawer :deep(.kima-listbox .kima-listbox__option) {
  min-height: 68px;
  padding: 12px 16px;
  border: 1px solid transparent;
  border-radius: 16px;
  background: var(--la-layer-01);
  color: var(--la-text);
  transition:
    background-color var(--kima-duration-medium) var(--kima-curve-standard),
    border-color var(--kima-duration-medium) var(--kima-curve-standard);
}

.permission-drawer :deep(.kima-listbox .kima-listbox__option:hover) {
  border-color: var(--la-line);
  background: var(--la-layer-02);
}

.permission-drawer :deep(.kima-listbox .kima-listbox__option[aria-selected="true"]) {
  border-color: var(--la-accent-border);
  background: color-mix(in srgb, var(--la-accent) 9%, var(--la-layer-01));
  color: var(--la-text);
}

.permission-drawer :deep(.kima-listbox .kima-listbox__option[aria-selected="true"]:hover) {
  background: color-mix(in srgb, var(--la-accent) 13%, var(--la-layer-01));
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
