<!--
对话流组件：从 store 读取当前活跃会话的消息列表，渲染用户消息气泡和助手执行活动流。
用户消息参考 Grok 的右对齐气泡，Assistant 使用卡片流展示工具执行过程和文本回复。
调用示例：<ConversationFlow />。
-->
<script setup>
import { computed, nextTick, ref } from 'vue'           // 引入响应式计算和滚动控制
import { store } from '../store.js'                     // 引入全局会话数据
import { renderMarkdown } from '../utils/markdown.js'   // 引入 Markdown 转 HTML 能力
import { watchMessages } from '../watchers.js'          // 引入集中管理的消息监听
import ToolExpansion from './ToolExpansion.vue'          // 复用工具标题、详情折叠与回退确认

const flowContainer = ref(null)                         // 容器引用，用于自动滚动到底部
const session = computed(() => store.sessions[store.ui.activeSessionID] || null) // 当前活跃会话
const messages = computed(() => session.value?.messages || []) // 当前会话消息列表


// --- 自动滚动到底部 ---
function scrollToBottom() {
  nextTick(() => {
    const container = flowContainer.value?.closest('.chat-page__scroll') // 滚动容器是外层 .chat-page__scroll
    if (container) container.scrollTop = container.scrollHeight // 新消息后显示最新内容
  })
}

// 通过 watchers.js 统一管理的消息变化监听，新消息到达时自动向下滚动
watchMessages(messages, scrollToBottom)


// --- 工具图标映射 ---
function toolIcon(toolName) {
  if (toolName?.includes('file') || toolName?.includes('edit')) return 'dashboard_customize' // 文件类工具
  if (toolName?.includes('shell') || toolName?.includes('command') || toolName?.includes('terminal')) return 'terminal' // 终端类工具
  if (toolName?.includes('search') || toolName?.includes('grep')) return 'search' // 搜索类工具
  return 'build'                                        // 其他工具使用通用图标
}
</script>

<template>
  <main ref="flowContainer" class="conversation-flow" aria-label="对话内容">
    <template v-for="(message, index) in messages" :key="message.id || index">
      <!-- 用户消息：紧凑气泡 -->
      <section v-if="message.role === 'user'" class="conversation-flow__user-turn" aria-label="用户消息">
        <p class="conversation-flow__user-message">{{ typeof message.content === 'string' ? message.content : '' }}</p>
      </section>

      <!-- 助手消息：活动流卡片 -->
      <section v-else-if="message.role === 'assistant'" class="conversation-flow__assistant-turn" aria-label="Agent 执行过程">
        <div class="conversation-flow__activity-list">
          <!-- API 用量行 -->
          <m3e-card v-if="message.request?.input || message.request?.output" class="conversation-flow__activity-card" variant="filled">
            <div slot="content" class="conversation-flow__api-row">
              <m3e-icon name="sync_alt" filled="1"></m3e-icon>
              <span>API 请求</span>
              <span class="conversation-flow__api-cost">
                <span>↑{{ message.request.input }}</span>
                <span>↓{{ message.request.output }}</span>
              </span>
            </div>
          </m3e-card>

          <!-- 文本内容块（模型思考和回复）-->
          <m3e-card v-if="message.content" class="conversation-flow__activity-card" variant="filled">
            <div slot="content" class="conversation-flow__message-block" v-html="renderMarkdown(message.content)"></div>
          </m3e-card>

          <!-- 流式打字指示器 -->
          <m3e-card v-if="message.isStreaming && !message.content && !(message.tools || []).length" class="conversation-flow__activity-card" variant="filled">
            <div slot="content" class="conversation-flow__message-block">
              <p class="conversation-flow__typing">正在思考...</p>
            </div>
          </m3e-card>

          <!-- 工具调用卡片（模型决定执行的动作）-->
          <m3e-card v-for="tool in (message.tools || [])" :key="tool.id" class="conversation-flow__activity-card" variant="filled">
            <div slot="content">
              <ToolExpansion :icon="toolIcon(tool.name)" :label="tool.status === 'running' ? '正在运行' : tool.status === 'completed' ? '已完成' : tool.status === 'error' ? '执行失败' : '等待中'" :parameter="tool.name + (tool.input?.command ? ' ' + tool.input.command : tool.input?.path ? ' ' + tool.input.path : '')" :open="tool.status === 'running'">
                <pre v-if="tool.preview" class="conversation-flow__terminal"><code>{{ tool.preview }}</code></pre>
              </ToolExpansion>
            </div>
          </m3e-card>

          <!-- 错误显示 -->
          <m3e-card v-if="message.error" class="conversation-flow__activity-card" variant="filled">
            <div slot="content" class="conversation-flow__message-block">
              <p class="conversation-flow__error">{{ message.error }}</p>
            </div>
          </m3e-card>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped lang="scss">
/* --- 对话流主容器：垂直排列用户和助手轮次 --- */
.conversation-flow {
  display: flex;
  flex-direction: column;
  gap: 48px;
  width: min(960px, 100%);
  margin: 0 auto;
  padding: 56px 32px 24px;
}

/* --- 用户消息轮次：右对齐气泡布局 --- */
.conversation-flow__user-turn {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

/* --- 用户消息气泡：圆角矩形仿 Grok 右下方缺角 --- */
.conversation-flow__user-message {
  max-width: min(620px, 82%);
  margin: 0;
  padding: 14px 20px;
  border: 1px solid #353535;
  border-radius: 22px 22px 6px 22px;                                /* 右下缺角标识发送方 */
  background: #1b1b1b;
  color: #f2f2f2;
  font-size: 17px;
  line-height: 1.55;
}

/* --- 消息操作栏：悬停时淡入的回退和复制 --- */
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
  opacity: 1;                                                        /* 悬停或键盘聚焦时显示操作 */
  pointer-events: auto;
}

/* --- 助手轮次：左对齐活动流卡片 --- */
.conversation-flow__assistant-turn { min-width: 0; }

.conversation-flow__activity-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* --- 活动卡片：透明无阴影容器 --- */
.conversation-flow__activity-card {
  --m3e-card-padding: 0;
  --m3e-filled-card-container-color: transparent;
  --m3e-filled-card-container-elevation: none;
  min-width: 0;
}

/* --- API 请求行：低对比度用量摘要 --- */
.conversation-flow__api-row {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 12px;
  padding-inline: 12px;
  color: #676b75;
  font-size: 14px;
  opacity: .42;                                                      /* 默认弱化避免干扰阅读流 */
  transition: opacity 160ms ease, color 160ms ease;

  &:hover,
  &:focus-within {
    color: #aeb2bc;
    opacity: 1;                                                      /* 悬停时恢复完整可见度 */
  }

  > m3e-icon {
    flex: 0 0 20px;
    font-size: 20px;
  }
}

/* --- API 用量数字：右侧固定宽度 --- */
.conversation-flow__api-cost {
  display: flex;
  margin-left: auto;
  gap: 8px;
  padding: 0;
  font-size: 12px;
  white-space: nowrap;
}

/* --- 助手文本消息块 --- */
.conversation-flow__message-block {
  display: flex;
  flex-direction: column;
  gap: 20px;
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

/* --- 代码差异块：暗底带行高亮 --- */
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

/* --- 终端输出块：无边框等宽字体 --- */
.conversation-flow__terminal {
  margin: 0;
  padding: 0;
  overflow-x: auto;
  color: #c8cbd3;
  font: 17px/1.7 "Cascadia Code", Consolas, monospace;
  scrollbar-width: thin;
  scrollbar-color: #555555 transparent;
}

/* --- 代码语法高亮色彩 --- */
.code-add { color: #86d986; }                                        /* 新增行绿色 */
.code-prompt { color: #a66cff; }                                     /* 终端提示符紫色 */
.code-command { color: #68a9ff; }                                    /* 命令蓝色 */
.code-output { color: #a8a8a8; }                                     /* 输出灰色 */

/* --- 移动端适配：收窄间距和字号 --- */
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
