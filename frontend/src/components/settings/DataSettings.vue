<!-- 数据设置：展示导入、导出和清理命令，并反馈最近结果。 -->
<script setup>
import { ref } from 'vue'                                                // 引入文件选择和清理确认状态
import { t } from '../../i18n.js'                                      // 提供数据管理动作文案
defineProps({ feedback: { type: String, default: '' } })
const emit = defineEmits(['action'])                                  // 将真实文件和确认动作交回设置指令
const fileInput = ref(null)                                            // 保存隐藏备份文件选择器
const clearOpen = ref(false)                                           // 控制清理数据确认弹窗


// --- 提交备份文件 ---
function importFile(event) {
  const file = event.target.files?.[0]                                 // 读取用户选择的单个 JSON 备份
  if (file) emit('action', 'import', file)                              // 将真实文件交给导入指令
  event.target.value = ''                                               // 允许稍后重复选择同一文件
}
</script>

<template>
  <section class="simple-settings data-settings">
    <header class="simple-settings__heading"><div><h3>{{ t('dataManagement') }}</h3><p>{{ t('dataDescription') }}</p></div></header>
    <m3e-card><div class="data-setting-row"><m3e-avatar><m3e-icon name="download"></m3e-icon></m3e-avatar><div><strong>{{ t('exportData') }}</strong><small>{{ t('exportDescription') }}</small></div><m3e-button variant="tonal" @click="emit('action', 'export')">{{ t('export') }}</m3e-button></div></m3e-card>
    <m3e-card><div class="data-setting-row"><m3e-avatar><m3e-icon name="upload"></m3e-icon></m3e-avatar><div><strong>{{ t('importData') }}</strong><small>{{ t('importDescription') }}</small></div><input ref="fileInput" class="visually-hidden" type="file" accept="application/json,.json" @change="importFile" /><m3e-button variant="tonal" @click="fileInput.click()">{{ t('import') }}</m3e-button></div></m3e-card>
    <m3e-card class="is-danger"><div class="data-setting-row"><m3e-avatar><m3e-icon name="delete"></m3e-icon></m3e-avatar><div><strong>{{ t('clearData') }}</strong><small>{{ t('clearDescription') }}</small></div><m3e-button variant="tonal" class="danger-command" @click="clearOpen = true">{{ t('clear') }}</m3e-button></div></m3e-card>
    <div v-if="feedback" class="inline-feedback">{{ feedback }}</div>
    <m3e-dialog :open="clearOpen" @closed="clearOpen = false"><span slot="header">{{ t('clearData') }}</span><span>将删除全部 Session 与 Workspace 索引，但不会删除本地目录内容。</span><div slot="actions" end><m3e-button><m3e-dialog-action @click="clearOpen = false">{{ t('cancel') }}</m3e-dialog-action></m3e-button><m3e-button variant="filled" class="danger-command"><m3e-dialog-action @click="emit('action', 'clear'); clearOpen = false">{{ t('clear') }}</m3e-dialog-action></m3e-button></div></m3e-dialog>
  </section>
</template>
