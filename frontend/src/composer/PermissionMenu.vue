<!--
输入框上的权限菜单：和 Roo Code 的自动批准菜单一样，点盾牌展开一组复选框。
菜单是浮层，不占对话高度；分类文案和图标仍来自 AUTO_APPROVE_KINDS。
调用示例：<PermissionMenu :auto-approve="session.settings.autoApprove" @toggle="Session.toggleAutoApprove(session.id, $event)" />
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { KimaCheckbox } from '@kernel4632/kima'
import { AppIcon } from '../ui/index.js'
import { AUTO_APPROVE_KINDS } from '../commands/session.js'

const props = defineProps({
  autoApprove: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['toggle'])

const open = ref(false)
const trigger = ref(null)
const panel = ref(null)
const position = ref({ left: '12px', top: '12px' })
const enabled = computed(() => AUTO_APPROVE_KINDS.filter(item => props.autoApprove?.[item.kind]).length)

function place() {
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect) return
  const width = panel.value?.offsetWidth || 248
  const height = panel.value?.offsetHeight || 300
  const margin = 12
  const gap = 8
  const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin)
  // 优先停在整个输入框上方，别压住输入框自己的内容。
  const composer = trigger.value?.closest('.chat-composer')
  const anchorTop = composer?.getBoundingClientRect().top ?? rect.top
  const above = anchorTop - height - gap
  const top = above >= margin ? above : Math.min(window.innerHeight - height - margin, rect.bottom + gap)
  position.value = { left: `${left}px`, top: `${top}px` }
}

async function show() {
  open.value = true
  await nextTick()
  place()
  panel.value?.focus()
}

function close() {
  open.value = false
  trigger.value?.focus()
}

function toggle() {
  if (open.value) close()
  else void show()
}

function onKey(event) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  close()
}

function onResize() {
  if (open.value) place()
}

watch(open, value => {
  if (value) {
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
  } else {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('resize', onResize)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="composer-permission"
    :class="{ 'is-open': open }"
    aria-label="权限控制"
    aria-haspopup="dialog"
    aria-controls="composer-permission-panel"
    :aria-expanded="open"
    title="权限控制"
    @click="toggle"
  >
    <AppIcon name="permission" :size="20" />
  </button>

  <Teleport to="body">
    <Transition name="permission">
      <div v-if="open" class="permission-menu" @click="close">
        <div
          id="composer-permission-panel"
          ref="panel"
          class="permission-menu__panel"
          :style="position"
          role="dialog"
          aria-label="权限控制"
          tabindex="-1"
          @click.stop
        >
          <header class="permission-menu__head">
            <span>自动批准</span>
            <small>{{ enabled }} / {{ AUTO_APPROVE_KINDS.length }}</small>
          </header>
          <div class="permission-menu__list">
            <KimaCheckbox
              v-for="item in AUTO_APPROVE_KINDS"
              :key="item.kind"
              :label="item.label"
              :model-value="!!autoApprove?.[item.kind]"
              @update:model-value="emit('toggle', item.kind)"
            >
              <span class="permission-menu__name">{{ item.label }}</span>
            </KimaCheckbox>
          </div>
          <p class="permission-menu__note"><code>.agentignore</code> 仍然生效，危险操作仍会先问你。</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.composer-permission {
  display: grid;
  width: 40px;
  height: 40px;
  flex: none;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--la-text);
  cursor: pointer;
}
.composer-permission:hover { background: var(--la-hover); }
.composer-permission.is-open { background: var(--la-accent-soft); color: var(--la-accent); }

.permission-menu {
  position: fixed;
  inset: 0;
  z-index: 520;
}
.permission-menu__panel {
  position: fixed;
  width: min(280px, calc(100vw - 24px));
  padding: 14px;
  border-radius: 18px;
  background: var(--kima-color-surface-container);
  color: var(--kima-color-on-surface);
  box-shadow: var(--kima-elevation-3);
  font-family: var(--kima-font-family);
}
.permission-menu__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 6px; color: var(--kima-color-on-surface); font-size: 14px; font-weight: 600; line-height: 20px; }
.permission-menu__head small { color: var(--kima-color-on-surface-variant); font-size: 12px; font-weight: 500; }
.permission-menu__list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 4px; }
.permission-menu__list :deep(.kima-checkbox) { width: 100%; min-height: 44px; padding: 2px 4px; border-radius: 8px; }
.permission-menu__list :deep(.kima-checkbox:hover) { background: color-mix(in srgb, var(--kima-color-on-surface) 7%, transparent); }
.permission-menu__name { min-width: 0; color: var(--kima-color-on-surface); font-size: 13px; line-height: 18px; }
.permission-menu__note { margin: 8px 0 0; color: var(--kima-color-on-surface-variant); font-size: 11.5px; line-height: 17px; }
.permission-menu__note code { font-family: var(--kima-font-family); }

.permission-enter-active, .permission-leave-active { transition: opacity var(--kima-duration-medium) var(--kima-curve-standard); }
.permission-enter-active .permission-menu__panel, .permission-leave-active .permission-menu__panel { transition: opacity var(--kima-duration-fast) var(--kima-curve-standard), transform var(--kima-duration-medium) var(--kima-curve-emphasized); }
.permission-enter-from, .permission-leave-to { opacity: 0; }
.permission-enter-from .permission-menu__panel, .permission-leave-to .permission-menu__panel { opacity: 0; transform: translateY(6px) scale(.98); }
@media (max-width: 767px) {
  .composer-permission { width: 44px; height: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .permission-enter-active, .permission-leave-active, .permission-enter-active .permission-menu__panel, .permission-leave-active .permission-menu__panel { transition-duration: .01ms; }
}
</style>
