<!--
对话流组件：用户消息参考 Grok 的右对齐气泡，Assistant 使用 Agent 活动流展示执行过程。
组件当前承载静态预览内容，用于确认消息层级、工具步骤和响应式布局。
调用示例：<ConversationFlow />。
-->
<script setup>
import { ref } from 'vue'                              // 保存静态预览中两个工具的展开状态
import ToolExpansion from './ToolExpansion.vue'       // 复用工具标题、详情折叠与回退确认

const emit = defineEmits(['copy-message', 'rollback-message', 'rollback-tool']) // 将消息和工具操作交给业务层
const fileDetailsOpen = ref(false)                     // 文件差异默认收起，避免占用消息流高度
const commandDetailsOpen = ref(true)                   // 当前运行命令默认展开，直接展示执行反馈
</script>

<template>
  <main class="conversation-flow" aria-label="对话内容">
    <!-- 用户消息：紧凑气泡；悬停或聚焦时展示时间与操作。 -->
    <section class="conversation-flow__user-turn" aria-label="用户消息">
      <p class="conversation-flow__user-message">检查消息流组件的结构，并修复会话操作按钮的交互问题。</p>
      <div class="conversation-flow__message-actions" aria-label="用户消息操作">
        <span class="conversation-flow__message-time">刚刚</span>
        <m3e-icon-button type="button" shape="rounded" aria-label="回退" title="回退" @click="emit('rollback-message')">
          <m3e-icon name="undo" filled="1"></m3e-icon>
        </m3e-icon-button>
        <m3e-icon-button type="button" shape="rounded" aria-label="复制" title="复制" @click="emit('copy-message')">
          <m3e-icon name="content_copy" filled="1"></m3e-icon>
        </m3e-icon-button>
      </div>
    </section>

    <!-- Agent：以 Roo Code 风格卡片流展示执行过程。 -->
    <section class="conversation-flow__assistant-turn" aria-label="Agent 执行过程">
      <div class="conversation-flow__activity-list">
        <m3e-card class="conversation-flow__activity-card" variant="filled">
          <div slot="content">
            <ToolExpansion v-model:open="fileDetailsOpen" icon="dashboard_customize" label="需要编辑文件" parameter="components/src/components/HomePage.vue" @rollback="emit('rollback-tool', 'edit-file')">
              <pre class="conversation-flow__code"><code><span class="code-add">+ @click.stop="openRenameDialog(conversation)"</span>
<span class="code-add">+ :has(.conversation-actions:hover) {</span>
<span class="code-add">+   transform: scale(1);</span>
<span class="code-add">+ }</span></code></pre>
            </ToolExpansion>
          </div>
        </m3e-card>

        <m3e-card class="conversation-flow__activity-card" variant="filled">
          <div slot="content" class="conversation-flow__api-row">
            <m3e-icon name="sync_alt" filled="1"></m3e-icon>
            <span>API 请求</span>
            <span class="conversation-flow__api-cost">
              <span>Tokens:42050</span>
              <span>↑38139</span>
              <span>↓3911</span>
            </span>
          </div>
        </m3e-card>

        <m3e-card class="conversation-flow__activity-card" variant="filled">
          <div slot="content" class="conversation-flow__message-block">
            <p>图标按钮已经阻止事件冒泡，但父级仍会命中 CSS 的 <code>:hover</code> 与 <code>:active</code>。需要在操作区交互时暂停会话项自身的 transform，只保留图标按钮的 ripple 和弹性反馈。</p>
          </div>
        </m3e-card>

        <m3e-card class="conversation-flow__activity-card" variant="filled">
          <div slot="content">
            <ToolExpansion v-model:open="commandDetailsOpen" icon="terminal" label="正在运行" parameter="bun run build" :icon-filled="false" @rollback="emit('rollback-tool', 'run-command')">
              <pre class="conversation-flow__terminal"><code><span class="code-prompt">›</span> <span class="code-command">bun run build</span>
<span class="code-output">✓ 54 modules transformed</span>
<span class="code-output">✓ built in 369ms</span></code></pre>
            </ToolExpansion>
          </div>
        </m3e-card>

        <m3e-card class="conversation-flow__activity-card" variant="filled">
          <div slot="content" class="conversation-flow__message-block">
            <p>会话项与内部操作按钮的交互已经隔离。点击重命名或删除时，父级保持稳定，只有目标图标按钮执行按压、ripple 和弹性回弹。</p>
          </div>
        </m3e-card>
      </div>
    </section>
  </main>
</template>

<style scoped lang="scss">
.conversation-flow {
  display: flex;
  flex-direction: column;
  gap: 48px;
  width: min(960px, 100%);
  min-height: 100%;
  margin: 0 auto;
  padding: 56px 32px 80px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #555555 transparent;

  &::-webkit-scrollbar { width: 8px; }
  &::-webkit-scrollbar-track { background: transparent; }

  &::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 999px;
    background: #555555;
    background-clip: padding-box;
  }

  &::-webkit-scrollbar-thumb:hover { background-color: #747474; }
}

.conversation-flow__user-turn {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.conversation-flow__user-message {
  max-width: min(620px, 82%);
  margin: 0;
  padding: 14px 20px;
  border: 1px solid #353535;
  border-radius: 22px 22px 6px 22px;
  background: #1b1b1b;
  color: #f2f2f2;
  font-size: 17px;
  line-height: 1.55;
}

.conversation-flow__api-row {
  display: flex;
  align-items: center;
}

.conversation-flow__message-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #b5b5b5;
  font-size: 14px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 160ms ease;
}

.conversation-flow__user-turn:hover .conversation-flow__message-actions,
.conversation-flow__user-turn:focus-within .conversation-flow__message-actions {
  opacity: 1;
  pointer-events: auto;
}

.conversation-flow__assistant-turn { min-width: 0; }

.conversation-flow__activity-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.conversation-flow__activity-card {
  --m3e-card-padding: 0;
  --m3e-filled-card-container-color: transparent;
  --m3e-filled-card-container-elevation: none;
  min-width: 0;
}

.conversation-flow__message-block {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.conversation-flow__api-row {
  min-width: 0;
  gap: 12px;
  padding-inline: 12px;
  color: #676b75;
  font-size: 14px;
  opacity: .42;
  transition: opacity 160ms ease, color 160ms ease;

  &:hover,
  &:focus-within {
    color: #aeb2bc;
    opacity: 1;
  }

  > m3e-icon {
    flex: 0 0 20px;
    font-size: 20px;
  }
}

.conversation-flow__api-cost {
  display: flex;
  margin-left: auto;
  gap: 8px;
  padding: 0;
  font-size: 12px;
  white-space: nowrap;
}

.conversation-flow__message-block {
  padding-inline: 12px;

  p {
    width: 100%;
    margin: 0;
    color: #d0d3dc;
    font-size: 18px;
    line-height: 1.65;
  }

  code {
    color: #f0f0f0;
    font-family: "Cascadia Code", Consolas, monospace;
  }
}

.conversation-flow__code {
  margin: 12px 0 0;
  padding: 14px 16px;
  overflow-x: auto;
  border: 1px solid #2b2b2b;
  border-radius: 8px;
  background: #111111;
  color: #cfcfcf;
  font: 14px/1.7 "Cascadia Code", Consolas, monospace;
  scrollbar-width: thin;
  scrollbar-color: #555555 transparent;

  &::-webkit-scrollbar { height: 8px; }
  &::-webkit-scrollbar-track { background: transparent; }

  &::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 999px;
    background: #555555;
    background-clip: padding-box;
  }

  &::-webkit-scrollbar-thumb:hover { background-color: #747474; }
}

.conversation-flow__terminal {
  margin: 0;
  padding: 0;
  overflow-x: auto;
  color: #c8cbd3;
  font: 17px/1.7 "Cascadia Code", Consolas, monospace;
  scrollbar-width: thin;
  scrollbar-color: #555555 transparent;
}

.code-add { color: #86d986; }
.code-prompt { color: #a66cff; }
.code-command { color: #68a9ff; }
.code-output { color: #a8a8a8; }

.conversation-flow m3e-icon-button {
  transform: scale(1);
  transition: transform var(--motion-duration-spring) var(--motion-spring-bouncy), filter 120ms ease;

  &:hover {
    filter: brightness(1.08);
    transform: translateY(-.5px) scale(1.01);
  }

  &:active {
    filter: brightness(.94);
    transform: scale(.96);
    transition-duration: var(--motion-duration-press);
    transition-timing-function: ease-out;
  }
}

@media (max-width: 640px) {
  .conversation-flow {
    gap: 36px;
    padding: 32px 16px 56px;
  }

  .conversation-flow__user-message {
    max-width: 92%;
    font-size: 16px;
  }

  .conversation-flow__activity-list { gap: 12px; }

  .conversation-flow__api-row,
  .conversation-flow__message-block {
    padding-inline: 2px;
  }

  .conversation-flow__message-block p { font-size: 16px; }
}
</style>
