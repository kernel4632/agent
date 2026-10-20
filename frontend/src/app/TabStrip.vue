<!--
顶部标签条：只显示标签并发出切换、关闭、新建事件，不读写会话数据。
select 和 close 都会带回完整的标签对象，调用方不再需要按 key 查找。
调用示例：<TabStrip :tabs="tabs" :active-key="activeKey" @select="openTab" @close="closeTab" @new="openDraft" />
-->
<script setup>
import AppIcon from '../components/AppIcon.vue'

defineProps({
  tabs: { type: Array, default: () => [] },              // 每项包含 key、title、color，其余字段原样保留
  activeKey: { type: String, default: '' },
})

const emit = defineEmits(['select', 'close', 'new'])
</script>

<template>
  <div class="titlebar__tabs" role="tablist" aria-label="打开的会话">
    <div v-for="tab in tabs" :key="tab.key" class="tab" :class="{ 'is-active': activeKey === tab.key }" role="tab" :aria-selected="activeKey === tab.key">
      <button class="tab__main" @click="emit('select', tab)">
        <span class="tab__avatar" :style="{ background: tab.color }" aria-hidden="true">{{ (tab.title || '新').slice(0, 1) }}</span>
        <span class="tab__title">{{ tab.title }}</span>
      </button>
      <!-- 关闭按钮阻止冒泡，避免先切换标签再关闭。 -->
      <button class="tab__close" :aria-label="`关闭 ${tab.title}`" @click.stop="emit('close', tab)"><AppIcon name="close" :size="11" /></button>
    </div>
    <button class="tab-new" aria-label="新建对话" title="新建对话" @click="emit('new')"><AppIcon name="plus" :size="15" /></button>
  </div>
</template>

<style scoped lang="scss">
.titlebar__tabs { display: flex; align-items: center; gap: 2px; min-width: 0; flex: 1; overflow-x: auto; scrollbar-width: none; }
.titlebar__tabs::-webkit-scrollbar { display: none; }
.tab { display: flex; align-items: center; min-width: 0; height: 28px; flex: 0 1 auto; border-radius: 6px; color: var(--la-secondary); }
.tab:hover { background: var(--la-hover); color: var(--la-text); }
.tab.is-active { background: var(--la-layer-02); color: var(--la-text); }
.tab__main { display: flex; align-items: center; gap: 6px; min-width: 0; height: 100%; padding: 0 8px; border: 0; background: transparent; color: inherit; cursor: pointer; }
.tab__avatar { display: grid; place-items: center; width: 16px; height: 16px; flex: 0 0 16px; border-radius: 3px; color: #fff; font: 600 8px/1 var(--la-font-mono); }
.tab__title { max-width: 190px; overflow: hidden; font-size: 13px; font-weight: 440; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
.tab__close { display: grid; place-items: center; width: 20px; height: 20px; margin-right: 4px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--la-muted); opacity: 0; cursor: pointer; }
.tab.is-active .tab__close, .tab:hover .tab__close, .tab:focus-within .tab__close { opacity: 1; }
.tab__close:hover { background: var(--la-hover); color: var(--la-text); }
.tab-new { display: grid; place-items: center; width: 28px; height: 28px; flex: 0 0 28px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--la-muted); cursor: pointer; }
.tab-new:hover { background: var(--la-hover); color: var(--la-text); }
@media (max-width: 767px) {
  .tab__title { max-width: 120px; }
}
</style>
