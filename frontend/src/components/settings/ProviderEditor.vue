<!--
供应商编辑器：编辑单个供应商的连接信息、认证数据和启用状态。
设计思想：只处理字段输入和可见性切换，每次修改立即通过 emit 交给父组件合并到草稿。
核心数据：provider（包含 name、enabled、apiType、apiUrl、apiKey、models）。
核心方法：updateProvider（合并单字段补丁并上抛）。
调用示例：<ProviderEditor :provider="selectedProvider" @update:provider="updateProvider" />。
-->
<script setup>
import { ref, useId } from 'vue'                    // 引入响应式状态和唯一 ID 生成能力
import ProviderModels from './ProviderModels.vue'  // 引入模型列表管理子组件
import { HugeiconsIcon } from '@hugeicons/vue'
import { Delete01Icon, EyeIcon, EyeOffIcon } from '@hugeicons/core-free-icons'
import { ICON_STROKE_WIDTH } from '../../theme.js'

const props = defineProps({ provider: { type: Object, required: true } }) // 接收当前编辑的供应商完整对象
const emit = defineEmits(['delete', 'update:provider']) // 输出删除请求和合并后的供应商对象
const showApiKey = ref(false)                      // 控制 API Key 输入框明文/密文切换
const fieldID = useId()                            // 表单内所有字段共享的唯一 ID 前缀
const deleteDialog = ref(null)


// --- 合并单个字段并提交完整供应商 ---
function updateProvider(patch) {
  emit('update:provider', { ...props.provider, ...patch }) // 保持未修改字段不变，仅更新 patch 指定字段
}

function requestDelete() {
  deleteDialog.value.show()
}


</script>

<template>
  <form class="provider-editor" @submit.prevent>
    <!-- 第一排：供应商名称输入框和启用/停用开关。 -->
    <header class="provider-editor__title-row">
      <m3e-form-field class="provider-editor__name-field" variant="outlined" hide-subscript="always">
        <label slot="label" :for="`${fieldID}-name`">供应商名</label>
        <input
          :id="`${fieldID}-name`"
          :value="props.provider.name"
          @input="updateProvider({ name: $event.currentTarget.value })"
        />
      </m3e-form-field>
      <label class="provider-editor__enabled">
        <span>{{ props.provider.enabled ? '已启用' : '已停用' }}</span>
        <m3e-switch :checked="props.provider.enabled" @change="updateProvider({ enabled: $event.currentTarget.checked })"></m3e-switch>
      </label>
    </header>

    <!-- 第二排：接口类型选择器和 API 地址输入框。 -->
    <section class="provider-editor__section">
      <div class="provider-editor__connection">
        <m3e-form-field class="provider-editor__type-field" variant="outlined" hide-subscript="always">
          <label slot="label" :for="`${fieldID}-api-type`">接口类型</label>
          <m3e-select :id="`${fieldID}-api-type`" @change="updateProvider({ apiType: $event.currentTarget.value })">
            <m3e-option value="openai-compatible" selected>OpenAI 兼容</m3e-option>
          </m3e-select>
        </m3e-form-field>
        <m3e-form-field class="provider-editor__field" variant="outlined" hide-subscript="always">
          <label slot="label" :for="`${fieldID}-api-url`">请求地址（API）</label>
          <input :id="`${fieldID}-api-url`" :value="props.provider.apiUrl" type="url" placeholder="https://api.example.com/v1" @input="updateProvider({ apiUrl: $event.currentTarget.value })" />
        </m3e-form-field>
      </div>
    </section>

    <!-- 第三排：API Key 输入框和明文/密文切换按钮。 -->
    <section class="provider-editor__section">
      <span class="provider-editor__secret">
        <m3e-form-field class="provider-editor__field" variant="outlined" hide-subscript="always">
          <label slot="label" :for="`${fieldID}-api-key`">API Key</label>
          <input :id="`${fieldID}-api-key`" :value="props.provider.apiKey" :type="showApiKey ? 'text' : 'password'" autocomplete="off" placeholder="输入 API Key" @input="updateProvider({ apiKey: $event.currentTarget.value })" />
        </m3e-form-field>
          <m3e-icon-button type="button" :aria-label="showApiKey ? '隐藏 API Key' : '显示 API Key'" @click="showApiKey = !showApiKey">
            <HugeiconsIcon :icon="showApiKey ? EyeOffIcon : EyeIcon" :stroke-width="ICON_STROKE_WIDTH" />
          </m3e-icon-button>
      </span>
    </section>

    <!-- 第四排：模型列表管理子组件。 -->
    <section class="provider-editor__section">
      <ProviderModels :provider="props.provider" :models="props.provider.models" @update:models="updateProvider({ models: $event })" />
    </section>

    <section class="provider-editor__actions">
      <m3e-icon-button type="button" shape="rounded" aria-label="删除供应商" @click="requestDelete">
        <HugeiconsIcon :icon="Delete01Icon" :stroke-width="ICON_STROKE_WIDTH" />
      </m3e-icon-button>
    </section>

  </form>

  <m3e-dialog ref="deleteDialog" dismissible aria-label="删除供应商确认">
    <m3e-heading slot="header" variant="headline" size="small" level="2">删除供应商？</m3e-heading>
    <p>此供应商的未保存配置将被移除。</p>
    <div slot="actions" class="provider-editor__dialog-actions" end>
      <m3e-button type="button" shape="square"><m3e-dialog-action return-value="cancel">取消</m3e-dialog-action></m3e-button>
      <m3e-button type="button" variant="filled" shape="square" @click="emit('delete')"><m3e-dialog-action return-value="delete">删除</m3e-dialog-action></m3e-button>
    </div>
  </m3e-dialog>
</template>

<style scoped lang="scss">
/* --- 编辑器主容器：垂直排列各个表单分区 --- */
.provider-editor {
  display: flex;
  width: min(820px, 100%);
  margin: 0 auto;
  flex-direction: column;
  gap: 28px;
  padding: 36px 40px 72px;
}

/* --- 标题行：供应商名和启用开关 --- */
.provider-editor__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.provider-editor__name-field { width: min(420px, 100%); }

.provider-editor__enabled {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 10px;
  color: var(--md-sys-color-outline);
  font-size: 13px;
}

/* --- 表单分区通用样式 --- */
.provider-editor__section { padding: 0; }

.provider-editor__actions {
  padding-top: 12px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
}

.provider-editor__dialog-actions { display: flex; gap: 8px; }

.provider-editor__field {
  width: 100%;
  min-width: 0;
}

/* --- 连接信息行：接口类型和 API 地址 --- */
.provider-editor__connection {
  display: flex;
  align-items: center;
  gap: 12px;
}

.provider-editor__type-field {
  width: 220px;
  flex: 0 0 220px;
}

/* --- API Key 行：输入框和可见性切换按钮 --- */
.provider-editor__secret {
  display: flex;
  align-items: center;
  gap: 8px;
}

.provider-editor__secret .provider-editor__field { flex: 1 1 auto; }

/* --- 移动端适配：减小内边距 --- */
@media (max-width: 760px) {
  .provider-editor { padding: 28px 22px 56px; }
}

/* --- 窄屏适配：纵向堆叠标题行和连接行 --- */
@media (max-width: 520px) {
  .provider-editor__title-row {
    align-items: stretch;
    flex-direction: column;
  }

  .provider-editor__connection {
    align-items: stretch;
    flex-direction: column;
  }

  .provider-editor__type-field {
    width: 100%;
    flex-basis: auto;
  }
}
</style>
