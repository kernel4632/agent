<!--
命令面板：搜索并执行命令或打开会话。
查询文本、选中索引和键盘操作都在组件内部处理；items 传入完整列表，选中后通过 select 交给调用方执行和关闭。
调用示例：<CommandPalette v-model:open="paletteOpen" :items="paletteItems" @select="runPalette" />
-->
<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { Button } from '../ui/index.js'

const props = defineProps({
  open: Boolean,                                        // 面板是否显示
  items: { type: Array, default: () => [] },            // 每项包含 id、label、hint，label 和 hint 参与搜索
})

const emit = defineEmits(['update:open', 'select'])

const query = ref('')
const index = ref(0)
const input = ref(null)

// 搜索范围和原来一致：标题或提示包含关键词就保留，最多显示 12 条。
const visibleItems = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return props.items
    .filter(item => !keyword || item.label.toLowerCase().includes(keyword) || (item.hint || '').toLowerCase().includes(keyword))
    .slice(0, 12)
})

// 每次打开都清空查询和选中项，等面板渲染后聚焦搜索框。
watch(() => props.open, async open => {
  if (!open) return
  query.value = ''
  index.value = 0
  await nextTick()
  input.value?.focus()
}, { immediate: true })

// 关键词一变，列表内容就变，选中项回到第一条，避免回车拿到已不存在的项。
watch(query, () => { index.value = 0 })

// 方向键循环切换；回车执行当前项；Esc 关闭。输入法组合中的回车不处理。
function keydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); emit('update:open', false); return }
  if (!visibleItems.value.length) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    index.value = (index.value + 1) % visibleItems.value.length
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    index.value = (index.value - 1 + visibleItems.value.length) % visibleItems.value.length
    return
  }
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault()
    emit('select', visibleItems.value[index.value])
  }
}
</script>

<template>
  <Transition name="palette">
    <div v-if="open" class="command-palette" role="dialog" aria-label="命令面板" @click.self="emit('update:open', false)">
    <div class="command-palette__panel">
      <!-- 搜索框是命令面板专用输入，保留原生以直接聚焦和即时过滤；后续换成搜索控件。 -->
      <input ref="input" v-model="query" class="command-palette__input" type="search" aria-label="搜索命令" placeholder="搜索命令或会话" @keydown="keydown" />
      <div class="command-palette__list" role="listbox" aria-label="命令">
        <!-- 搜索框仍是原生 input；命令项只换 Button 外壳，role 和选中状态原样保留。 -->
        <Button v-for="(item, itemIndex) in visibleItems" :key="item.id" variant="plain" class="command-palette__item" :class="{ 'is-active': itemIndex === index }" role="option" :aria-selected="itemIndex === index" @click="emit('select', item)">
          <span>{{ item.label }}</span><small>{{ item.hint }}</small>
        </Button>
        <p v-if="!visibleItems.length" class="command-palette__empty">没有匹配的命令</p>
      </div>
    </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
.command-palette {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 12vh 16px 16px;
  background: var(--la-scrim);
}
.command-palette__panel {
  display: flex;
  width: min(680px, 100%);
  max-height: min(560px, 72vh);
  flex-direction: column;
  overflow: hidden;
  border-radius: 20px;
  background: var(--la-layer-01);
  box-shadow: var(--la-shadow-overlay);
}
.command-palette__input {
  height: 64px;
  flex: none;
  padding: 0 20px;
  border: 0;
  border-bottom: .5px solid var(--la-line);
  outline: 0;
  background: transparent;
  color: var(--la-text);
  font: 16px/24px var(--la-font-sans);
}
.command-palette__input::placeholder { color: var(--la-muted); }
.command-palette__list { min-height: 0; overflow-y: auto; padding: 8px; }
.command-palette__item {
  display: flex;
  width: 100%;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 14px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--la-text);
  text-align: left;
  font-size: 15px;
  cursor: pointer;
}
.command-palette__item:hover, .command-palette__item.is-active { background: var(--la-layer-03); }
.command-palette__item small { overflow: hidden; color: var(--la-muted); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.command-palette__empty { margin: 0; padding: 24px 14px; color: var(--la-muted); font-size: 14px; }
.palette-enter-active, .palette-leave-active { transition: opacity .18s ease; }
.palette-enter-active .command-palette__panel, .palette-leave-active .command-palette__panel { transition: transform var(--kima-duration-medium) var(--kima-curve-standard), opacity var(--kima-duration-effects) var(--kima-curve-standard); }
.palette-enter-from, .palette-leave-to { opacity: 0; }
.palette-enter-from .command-palette__panel, .palette-leave-to .command-palette__panel { opacity: 0; transform: translateY(-10px) scale(.98); }
@media (prefers-reduced-motion: reduce) {
  .palette-enter-active, .palette-leave-active,
  .palette-enter-active .command-palette__panel, .palette-leave-active .command-palette__panel { transition-duration: .01ms; }
}
</style>
