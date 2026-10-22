<!--
收藏消息弹窗：数据只来自浏览器本地快照，后端没有收藏接口。
点击条目打开原会话；删除只影响本地收藏，不删除会话。
调用示例：<FavoritesDialog :open="favoritesOpen" @update:open="favoritesOpen = $event" @open-session="openSession" />
-->
<script setup>
import { AppIcon, Button, Dialog } from '../ui/index.js'
import { Favorites, removeFavorite } from '../commands/favorites.js'

defineProps({ open: Boolean })
const emit = defineEmits(['update:open', 'open-session'])

function openItem(item) {
  emit('update:open', false)
  emit('open-session', item.sessionID)
}
</script>

<template>
  <Dialog :open="open" label="收藏的消息" @update:open="emit('update:open', $event)">
    <div class="favorites-dialog">
      <h2>收藏的消息</h2>
      <p>这些快照保存在当前浏览器，不会上传到服务器。</p>
      <ul v-if="Favorites.items.length" class="favorites-list">
        <li v-for="item in Favorites.items" :key="item.key">
          <Button variant="plain" class="favorite-item" @click="openItem(item)">
            <span class="favorite-item__head">
              <span>{{ item.sessionTitle || '新会话' }}</span>
              <small>{{ item.role === 'user' ? '你的消息' : 'la 的回复' }}</small>
            </span>
            <span class="favorite-item__text">{{ item.text || '（没有文字内容）' }}</span>
          </Button>
          <button type="button" class="favorite-remove" aria-label="删除收藏" title="删除收藏" @click="removeFavorite(item.key)"><AppIcon name="trash" :size="14" /></button>
        </li>
      </ul>
      <p v-else class="favorites-empty">还没有收藏。在消息下方的工具条里点爱心就能收藏。</p>
      <div class="dialog-actions">
        <Button type="button" @click="emit('update:open', false)">关闭</Button>
      </div>
    </div>
  </Dialog>
</template>

<style scoped lang="scss">
.favorites-dialog { width: 100%; min-width: 0; }
.favorites-dialog h2 { margin: 0; color: var(--la-text); font-size: 24px; font-weight: 400; line-height: 32px; }
.favorites-dialog > p { margin: 16px 0 24px; color: var(--la-secondary); font-size: 14px; font-weight: 400; line-height: 20px; }
.favorites-list { display: grid; max-height: 55vh; gap: 6px; overflow-y: auto; margin: 0; padding: 0; list-style: none; }
.favorites-list li { position: relative; display: flex; align-items: stretch; border-radius: 12px; background: var(--la-layer-01); }
.favorite-item { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 4px; padding: 10px 36px 10px 12px; border: 0; border-radius: 12px; background: transparent; text-align: left; }
.favorite-item__head { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.favorite-item__head > span { overflow: hidden; color: var(--la-text); font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.favorite-item__head small { flex: none; color: var(--la-accent); font-size: 11px; }
.favorite-item__text { display: -webkit-box; overflow: hidden; color: var(--la-secondary); font-size: 12px; line-height: 18px; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.favorite-remove { position: absolute; top: 8px; right: 8px; display: grid; width: 26px; height: 26px; place-items: center; border: 0; border-radius: 50%; background: transparent; color: var(--la-muted); cursor: pointer; }
.favorite-remove:hover { background: var(--la-hover); color: var(--la-text); }
.favorites-empty { padding: 18px 12px; border-radius: 12px; background: var(--la-layer-01); text-align: center; }
</style>
