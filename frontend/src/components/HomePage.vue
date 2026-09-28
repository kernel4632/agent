<script setup>
import { computed, nextTick, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { store } from '../store.js'
import { Session } from '../commands/session.js'
import { UI } from '../commands/ui.js'

const emit = defineEmits(['start'])
const search = ref('')
const dialog = ref(null)
const mode = ref('')
const target = ref(null)
const value = ref('')
const busy = ref(false)
const sessions = computed(() => (store.workspaces[0]?.sessions || []).filter(item => (item.title || '').toLowerCase().includes(search.value.trim().toLowerCase())))
const models = computed(() => Object.entries(store.config.providers).flatMap(([provider, config]) => config.enabled ? config.models.map(model => ({ provider, model })) : []))
const selectedModel = computed(() => JSON.stringify([store.config.activeProvider, store.config.activeModel]))
const prompts = [
  { icon: 'code', title: '一起写点代码', description: '从想法到实现，少一点阻力', prompt: '我想实现一个功能，请先和我一起梳理需求与实现方案。' },
  { icon: 'document', title: '理清复杂信息', description: '提炼重点，让思路更清晰', prompt: '请帮我分析接下来提供的内容，提炼重点并整理成清晰的结构。' },
  { icon: 'spark', title: '探索新的灵感', description: '换一个角度，看见更多可能', prompt: '我想和你一起探索一个新想法，请先问我几个问题，帮助我明确方向。' },
]

function chooseModel(event) {
  const [provider, model] = JSON.parse(event.target.value)
  store.config.activeProvider = provider
  store.config.activeModel = model
}

function timeLabel(value) {
  if (!value) return '最近'
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

async function openDialog(kind, item) {
  mode.value = kind
  target.value = item
  value.value = kind === 'rename' ? item.title : ''
  dialog.value.showModal()
  await nextTick()
  dialog.value.querySelector('input')?.focus()
}

async function submitDialog() {
  if (busy.value) return
  busy.value = true
  try {
    const success = mode.value === 'rename' ? await Session.rename(target.value.id, value.value)
      : mode.value === 'delete' ? await Session.remove(target.value.id) : await Session.openByID(value.value)
    if (success) dialog.value?.close()
  } finally { busy.value = false }
}
</script>

<template>
  <section class="home-page" aria-label="工作台">
    <div class="home-page__inner">
      <section class="welcome">
        <div class="welcome__orbit" aria-hidden="true"><div class="welcome__sphere"><AppIcon name="spark" :size="30" /></div><span></span><i></i></div>
        <p class="eyebrow">A LITTLE IDEA. A NEW POSSIBILITY.</p>
        <h1>每个想法，都值得<span>实现。</span></h1>
        <p class="welcome__description">写下灵感，梳理思路，或解决一个难题。<br class="mobile-break" />你的 AI 搭档，随时准备出发。</p>
        <div class="welcome__actions">
          <button class="button button--primary" :disabled="store.ui.isLoading || busy" @click="emit('start', '')"><AppIcon name="plus" :size="17" />开始新对话<AppIcon name="arrow" :size="16" /></button>
          <label v-if="models.length" class="home-model"><span class="sr-only">新对话使用的模型</span><span class="status-dot"></span><select aria-label="新对话使用的模型" :value="selectedModel" @change="chooseModel"><option v-for="item in models" :key="JSON.stringify(item)" :value="JSON.stringify([item.provider, item.model])">{{ item.provider }} / {{ item.model }}</option></select></label>
          <button v-else class="text-button" @click="UI.openSettings()">先连接一个模型<AppIcon name="arrow" :size="13" /></button>
        </div>
      </section>

      <div class="prompt-grid">
        <button v-for="prompt in prompts" :key="prompt.title" class="prompt-card" @click="emit('start', prompt.prompt)">
          <span class="prompt-card__icon"><AppIcon :name="prompt.icon" :size="20" /></span><span><strong>{{ prompt.title }}</strong><small>{{ prompt.description }}</small></span><AppIcon name="arrow" :size="16" />
        </button>
      </div>

      <section class="recent">
        <header class="recent__heading"><div><h2>最近会话 <span>{{ store.workspaces[0]?.sessions.length || 0 }}</span></h2><p>留住思路，随时接着聊。</p></div><button class="text-button" @click="openDialog('open')"><AppIcon name="link" :size="14" />通过 ID 打开</button></header>
        <div class="recent__toolbar"><label class="recent__search"><AppIcon name="search" :size="17" /><input id="home-search" v-model="search" type="search" placeholder="搜索你的会话…" aria-label="搜索会话" /><kbd>Ctrl K</kbd></label><span class="recent__scope"><AppIcon name="clock" :size="14" />当前浏览器</span></div>
        <div v-if="store.ui.isLoading" class="recent__empty" role="status"><span class="loading-ring"></span><p>正在连接你的工作台…</p></div>
        <div v-else-if="!sessions.length" class="recent__empty"><span class="recent__empty-icon"><AppIcon :name="search ? 'search' : 'chat'" :size="24" /></span><h3>{{ search ? '没有找到相关会话' : '让第一段对话发生' }}</h3><p>{{ search ? '换个关键词，再找找看。' : '不必准备好所有答案，从一个问题开始就好。' }}</p><button v-if="!search" class="text-button" @click="emit('start', '')">新建对话<AppIcon name="arrow" :size="14" /></button><button v-else class="text-button" @click="search = ''">清除搜索</button></div>
        <div v-else class="recent__list">
          <article v-for="session in sessions" :key="session.id" class="session-row">
            <button class="session-row__open" @click="Session.open(session.id)"><span class="session-row__icon"><AppIcon name="chat" :size="18" /></span><span class="session-row__text"><strong>{{ session.title || '新对话' }}</strong><small>{{ session.model || '未选择模型' }}</small></span><time>{{ timeLabel(session.updatedAt || session.createdAt) }}</time></button>
            <div class="session-row__actions"><button class="icon-button" :aria-label="`重命名 ${session.title}`" title="重命名" @click="openDialog('rename', session)"><AppIcon name="edit" :size="16" /></button><button class="icon-button" :aria-label="`删除 ${session.title}`" title="删除会话" @click="openDialog('delete', session)"><AppIcon name="trash" :size="16" /></button></div>
          </article>
        </div>
      </section>

      <footer class="home-note"><AppIcon name="info" :size="15" /><p>会话内容由后端保存，当前浏览器只记录会话索引。后端尚未提供全量会话列表与工作区管理接口。</p><button disabled class="button" title="当前后端未提供工作区管理接口"><AppIcon name="folder" :size="15" />添加工作区</button></footer>
      <div class="home-signature"><span>la</span>给想法一点空间。</div>
    </div>

    <dialog ref="dialog" class="dialog" :aria-label="mode === 'delete' ? '删除会话' : mode === 'rename' ? '重命名会话' : '打开已有会话'" @cancel="!busy && dialog.close()">
      <form @submit.prevent="submitDialog"><h2>{{ mode === 'delete' ? '删除这段对话？' : mode === 'rename' ? '给对话一个新名字' : '继续已有的对话' }}</h2><p>{{ mode === 'delete' ? '这会从服务器永久删除该会话与历史记录，无法恢复。' : mode === 'rename' ? '一个清晰的名字，让下次继续更容易。' : '输入已有会话的 ID。读取成功后，会将它加入此浏览器的会话列表。' }}</p><label v-if="mode !== 'delete'">{{ mode === 'rename' ? '会话名称' : '会话 ID' }}<input v-model="value" class="field" required :maxlength="mode === 'rename' ? 120 : 100" :placeholder="mode === 'rename' ? '为会话命名' : '输入会话 ID'" /></label><div class="dialog-actions"><button type="button" class="button" :disabled="busy" @click="dialog.close()">取消</button><button class="button" :class="mode === 'delete' ? 'button--danger' : 'button--primary'" :disabled="busy">{{ busy ? '正在处理…' : mode === 'delete' ? '确认删除' : mode === 'rename' ? '保存名称' : '打开会话' }}</button></div></form>
    </dialog>
  </section>
</template>

<style scoped lang="scss">
.home-page { height: 100%; overflow-y: auto; position: relative; }
.home-page__inner { max-width: 1060px; padding: 0 48px; margin: 0 auto; }
.welcome { text-align: center; padding: 38px 0 36px; }
.welcome__orbit { position: relative; width: 104px; height: 92px; margin: 0 auto 24px; }
.welcome__sphere { position: absolute; width: 67px; height: 67px; left: 19px; top: 12px; display: grid; place-items: center; border: 1px solid #bcd4ff45; border-radius: 50%; color: #d2e5ff; background: radial-gradient(circle at 30% 20%, #c5e7f76e, transparent 50%), linear-gradient(150deg,#334c70,#121f3c 70%); box-shadow: inset -10px -12px 18px #070d2566, 0 0 60px #669fe526; }
.welcome__orbit > span { position: absolute; inset: 27px -2px; transform: rotate(-28deg); border: 1px solid #a5c3f04d; border-radius: 50%; pointer-events: none; }
.welcome__orbit > i { position: absolute; width: 5px; height: 5px; top: 16px; right: 10px; border-radius: 50%; background: #b7ccf4; box-shadow: 0 0 12px #b7ccf4aa; }
.welcome .eyebrow { margin: 0 0 14px; font-size: 9px; letter-spacing: 2.6px; }
.welcome h1 { margin: 0 0 17px; font-size: clamp(25px, 2.65vw, 38px); font-weight: 500; letter-spacing: 1px; line-height: 1.4; }
.welcome h1 > span { color: var(--la-accent); }
.welcome__description { margin: 0; font-size: 12px; line-height: 1.9; color: var(--la-secondary); }
.welcome__actions { display: flex; justify-content: center; align-items: center; gap: 18px; margin-top: 25px; }
.welcome__actions .button { min-height: 42px; padding-inline: 18px; }
.text-button { display: inline-flex; gap: 7px; align-items: center; }
.home-model { display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 240px; }
.home-model select { min-width: 0; color: var(--la-secondary); background: transparent; border: 0; font-size: 11px; padding: 7px 2px; text-overflow: ellipsis; }
.home-model option { background: var(--la-panel); }
.prompt-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 38px; }
.prompt-card { min-width: 0; display: flex; text-align: left; align-items: center; gap: 12px; padding: 21px 16px; border: 1px solid var(--la-line); border-radius: 12px; background: linear-gradient(110deg,var(--la-hover),transparent); color: var(--la-text); cursor: pointer; }
.prompt-card:hover { background: var(--la-accent-soft); border-color: var(--la-accent-border); }
.prompt-card__icon { color: #adc9e4; }
.prompt-card:nth-child(2) .prompt-card__icon { color: #b8b9d9; }
.prompt-card:nth-child(3) .prompt-card__icon { color: #d4b899; }
.prompt-card strong { display: block; font-size: 12px; font-weight: 500; }
.prompt-card small { display: block; margin-top: 8px; font-size: 10px; line-height: 1.5; color: var(--la-muted); }
.prompt-card > svg { margin-left: auto; color: var(--la-muted); }
.recent__heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 19px; }
.recent h2 { font-size: 15px; font-weight: 550; margin: 0; display: flex; align-items: center; gap: 9px; }
.recent h2 span { min-width: 20px; height: 19px; display: grid; place-items: center; border: 1px solid var(--la-line); border-radius: 5px; color: var(--la-muted); font-size: 10px; font-weight: 400; }
.recent__heading p { font-size: 11px; color: var(--la-muted); margin: 7px 0 0; }
.recent__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 15px; border-bottom: 1px solid var(--la-line); padding-bottom: 14px; }
.recent__search { display: flex; width: min(310px, 100%); align-items: center; gap: 10px; color: var(--la-muted); border: 1px solid var(--la-line); border-radius: 8px; padding: 0 12px; height: 36px; background: var(--la-hover); }
.recent__search:focus-within { border-color: var(--la-accent-border); }
.recent__search input { min-width: 0; flex: 1; background: none; border: none; outline: none; color: var(--la-text); font-size: 11px; }
.recent__search input::placeholder { color: var(--la-muted); }
.recent__search kbd { font: 9px/1.5 inherit; white-space: nowrap; color: var(--la-muted); opacity: .65; }
.recent__scope { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--la-muted); white-space: nowrap; }
.recent__empty { text-align: center; padding: 34px 12px 30px; }
.recent__empty-icon { width: 44px; height: 44px; display: grid; place-items: center; margin: auto; border: 1px solid var(--la-line); background: var(--la-hover); border-radius: 13px; color: var(--la-muted); }
.recent__empty h3 { font-size: 12px; font-weight: 500; margin: 16px 0 9px; }
.recent__empty p { font-size: 11px; color: var(--la-muted); margin: 10px 0; line-height: 1.8; }
.recent__empty .text-button { margin-top: 8px; font-size: 11px; }
.session-row { display: flex; align-items: center; border-bottom: 1px solid var(--la-line); gap: 5px; padding-right: 8px; }
.session-row:hover { background: var(--la-hover); }
.session-row__open { display: flex; flex: 1; min-width: 0; align-items: center; gap: 13px; background: none; border: 0; padding: 18px 10px; color: var(--la-text); text-align: left; cursor: pointer; }
.session-row__icon { color: var(--la-muted); }
.session-row__text { min-width: 0; }
.session-row strong { display: block; font-size: 12px; font-weight: 500; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.session-row small { display: block; font-size: 10px; color: var(--la-muted); margin-top: 6px; }
.session-row time { font-size: 10px; color: var(--la-muted); white-space: nowrap; margin-left: auto; }
.session-row__actions { display: flex; opacity: .35; }
.session-row:hover .session-row__actions, .session-row:focus-within .session-row__actions { opacity: 1; }
.home-note { display: flex; gap: 9px; align-items: center; padding-top: 18px; margin-top: 10px; border-top: 1px solid var(--la-line); color: var(--la-muted); }
.home-note > svg { flex-shrink: 0; }
.home-note p { font-size: 10px; line-height: 1.85; margin: 0; max-width: 510px; }
.home-note .button { font-size: 10px; min-height: 32px; flex-shrink: 0; margin-left: auto; }
.home-signature { display: flex; align-items: center; justify-content: center; gap: 10px; margin: 30px 0 24px; font-size: 9px; color: var(--la-muted); letter-spacing: 1px; opacity: .6; }
.home-signature span { font-size: 15px; letter-spacing: -1px; }
.mobile-break { display: none; }
.loading-ring { display: inline-block; width: 22px; height: 22px; border: 2px solid var(--la-line); border-top-color: var(--la-accent); border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 1100px) { .home-page__inner { padding-inline: 30px; } .prompt-card { padding: 18px 13px; gap: 10px; } .prompt-card > svg { display: none; } }
@media (max-width: 760px) { .home-page__inner { padding-inline: 20px; } .welcome { padding-top: 28px; } .welcome__description { font-size: 11px; } .mobile-break { display: block; } .welcome__actions { flex-wrap: wrap; gap: 14px; } .prompt-grid { grid-template-columns: 1fr; gap: 8px; margin-bottom: 30px; } .prompt-card { padding: 16px; gap: 14px; } .prompt-card > svg { display: block; } .prompt-card small { margin-top: 5px; } .recent__scope { display: none; } .recent__search { width: 100%; } .session-row time { display: none; } .session-row__actions { opacity: 1; } .home-note { flex-wrap: wrap; } .home-note p { flex: 1; } .home-note .button { margin-left: 24px; } .welcome__orbit { margin-bottom: 20px; } }
</style>
