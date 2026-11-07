<!--
数据管理：配置自动备份、恢复、导出和导入。
这里是独立页面，不编辑 Settings 草稿；恢复/导入成功后重新加载整份配置。
调用示例：<DataSettings />
-->
<script setup>
import { computed, onMounted, ref } from 'vue'
import { AgentAPI } from '../../utils/api.js'
import { Settings } from "../../features/settings.js"
import { Notice } from "../../utils/notice.js"
import Button from '../../ui/Button.vue'
import Dialog from '../../ui/Dialog.vue'
import Field from '../../ui/Field.vue'
import Switch from '../../ui/Switch.vue'
import SettingsList from '../../ui/SettingsList.vue'
import SettingsRow from '../../ui/SettingsRow.vue'

const backups = ref([])
const loading = ref(false)
const busy = ref(false)
const includeSecrets = ref(false)
const restoreTarget = ref(null)
const restorePreview = ref(null)
const restoreLoading = ref(false)
const importDraft = ref(null)
const fileInput = ref(null)
const storage = ref(null)
const storageError = ref('')
const storageOpen = ref(false)
const storagePath = ref('')
const storageBusy = ref(false)

const restoreOpen = computed({
  get: () => Boolean(restoreTarget.value),
  set: open => {
    if (open) return
    restoreTarget.value = null
    restorePreview.value = null
  },
})
const restoreSummary = computed(() => {
  const providers = restorePreview.value?.providers
  if (!Array.isArray(providers) || !providers.length) return ''
  return providers.map(provider => `${provider.name || '未命名'} · ${provider.models?.length || 0} 个模型`).join('；')
})
const importOpen = computed({
  get: () => Boolean(importDraft.value),
  set: open => { if (!open) importDraft.value = null },
})
const importSummary = computed(() => {
  const config = importDraft.value
  if (!config) return ''
  const providers = Array.isArray(config.providers) ? config.providers.length : 0
  const models = Array.isArray(config.providers)
    ? config.providers.reduce((sum, provider) => sum + (Array.isArray(provider.models) ? provider.models.length : 0), 0)
    : 0
  return `${providers} 个供应商，${models} 个模型`
})

const formatDate = value => {
  if (!value) return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date(value))
}
const formatSize = value => {
  const size = Number(value || 0)
  return size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`
}

async function load() {
  loading.value = true
  try {
    backups.value = await AgentAPI.getConfigBackups()
  } catch (error) {
    Notice.show(error.message)
  } finally {
    loading.value = false
  }
}

async function loadStorage() {
  try {
    storage.value = await AgentAPI.getSessionStorage()
    storageError.value = ''
  } catch (error) {
    storageError.value = error.message
  }
}

function openStorage() {
  storagePath.value = storage.value?.pending?.path || storage.value?.path || ''
  storageOpen.value = true
}

async function confirmStorage() {
  if (storageBusy.value) return
  storageBusy.value = true
  try {
    const result = await AgentAPI.setSessionStorage(storagePath.value.trim())
    storage.value = { ...storage.value, path: result.path, pending: result.pending, error: '' }
    storageError.value = ''
    storageOpen.value = false
    Notice.show('已安排迁移，重启后端后生效')
  } catch (error) {
    storageError.value = error.message
    Notice.show(error.message)
  } finally {
    storageBusy.value = false
  }
}

async function cancelStorage() {
  try {
    await AgentAPI.cancelSessionStorage()
    await loadStorage()
    Notice.show('已取消迁移')
  } catch (error) {
    Notice.show(error.message)
  }
}

async function reloadConfig() {
  if (!await Settings.load()) throw new Error('配置已恢复，但重新读取失败，请刷新页面')
  Settings.open()
}

function askRestore(backup) {
  restoreTarget.value = backup
  restorePreview.value = null
  restoreLoading.value = true
  AgentAPI.readConfigBackup(backup.id)
    .then(data => {
      if (restoreTarget.value?.id === backup.id) restorePreview.value = data.config
    })
    .catch(error => Notice.show(error.message))
    .finally(() => { restoreLoading.value = false })
}

async function confirmRestore() {
  if (!restoreTarget.value || busy.value) return
  busy.value = true
  try {
    await AgentAPI.restoreConfigBackup(restoreTarget.value.id)
    await reloadConfig()
    restoreTarget.value = null
    restorePreview.value = null
    Notice.show('配置已恢复')
    await load()
  } catch (error) {
    Notice.show(error.message)
  } finally {
    busy.value = false
  }
}

function chooseFile() {
  fileInput.value?.click()
}

async function readFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  try {
    const config = JSON.parse(await file.text())
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('配置文件必须是 JSON 对象')
    importDraft.value = config
  } catch (error) {
    Notice.show(`导入文件无效：${error.message}`)
  }
}

async function confirmImport() {
  if (!importDraft.value || busy.value) return
  busy.value = true
  try {
    await AgentAPI.importConfig(importDraft.value)
    await reloadConfig()
    importDraft.value = null
    Notice.show('配置已导入')
    await load()
  } catch (error) {
    Notice.show(error.message)
  } finally {
    busy.value = false
  }
}

async function download() {
  if (busy.value) return
  busy.value = true
  try {
    const blob = await AgentAPI.exportConfig(includeSecrets.value)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `agent-config-${includeSecrets.value ? 'full' : 'masked'}.json`
    link.click()
    URL.revokeObjectURL(url)
    Notice.show(includeSecrets.value ? '配置已导出（包含 API Key）' : '配置已导出（已脱敏）')
  } catch (error) {
    Notice.show(error.message)
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void load()
  void loadStorage()
})
</script>

<template>
  <section class="data-settings" aria-label="数据管理">
    <SettingsList title="存储位置">
      <SettingsRow wide title="会话数据目录" description="会话历史、文件快照和工具输出存放的位置">
        <div class="data-settings__storage">
          <code class="data-settings__path">{{ storage?.path || '正在读取…' }}</code>
          <div class="data-settings__storage-actions">
            <Button v-if="storage?.pending" variant="text" @click="cancelStorage">取消迁移</Button>
            <Button :disabled="storage?.envOverride" :title="storage?.envOverride ? '由 AGENT_SESSIONS 环境变量控制' : undefined" @click="openStorage">
              {{ storage?.envOverride ? '由环境变量控制' : '更改位置' }}
            </Button>
          </div>
          <p v-if="storage?.pending" class="data-settings__pending">等待重启迁移到 {{ storage.pending.path }}</p>
          <p v-if="storageError" class="data-settings__storage-error" role="alert">{{ storageError }}</p>
        </div>
      </SettingsRow>
    </SettingsList>

    <SettingsList title="配置备份">
      <SettingsRow v-for="backup in backups" :key="backup.id" :title="formatDate(backup.createdAt)" :description="`${backup.providers} 个供应商 · ${backup.models} 个模型 · ${formatSize(backup.size)}`">
        <Button variant="text" size="small" @click="askRestore(backup)">恢复</Button>
      </SettingsRow>
      <SettingsRow v-if="!backups.length" title="还没有备份" :description="loading ? '正在读取备份…' : '保存一次配置后会自动生成备份'" />
    </SettingsList>

    <SettingsList title="导出配置">
      <SettingsRow title="包含 API Key 和其他敏感值" description="关闭时导出脱敏配置，密钥和环境变量会替换为占位符">
        <Switch v-model="includeSecrets" label="包含 API Key 和其他敏感值" hide-label />
      </SettingsRow>
      <SettingsRow title="导出配置文件" :description="includeSecrets ? '导出文件会包含明文密钥，请只保存到可信位置' : '默认导出脱敏配置，适合分享和备份'">
        <Button :disabled="busy" @click="download">{{ includeSecrets ? '导出完整配置' : '导出脱敏配置' }}</Button>
      </SettingsRow>
    </SettingsList>

    <SettingsList title="导入配置">
      <SettingsRow title="从 JSON 导入" description="导入会整体替换当前配置；脱敏文件会保留同名供应商已有的 API Key">
        <Button :disabled="busy" @click="chooseFile">选择配置文件</Button>
      </SettingsRow>
    </SettingsList>
    <input ref="fileInput" class="data-settings__file" type="file" accept="application/json,.json" @change="readFile" />

    <Dialog :open="storageOpen" label="更改会话数据目录" @update:open="storageOpen = $event">
      <p class="data-settings__dialog-text">现有会话会复制到新目录，旧目录保留；重启后端后生效。</p>
      <Field v-model="storagePath" label="会话数据目录" placeholder="D:\AgentSessions" />
      <p class="data-settings__dialog-hint">目标目录必须是空目录。</p>
      <template #footer>
        <Button variant="text" :disabled="storageBusy" @click="storageOpen = false">取消</Button>
        <Button :disabled="storageBusy || !storagePath.trim()" @click="confirmStorage">{{ storageBusy ? '安排中…' : '安排迁移' }}</Button>
      </template>
    </Dialog>

    <Dialog :open="restoreOpen" label="恢复配置备份" @update:open="restoreOpen = $event">
      <p class="data-settings__dialog-text">确定恢复 {{ restoreTarget ? formatDate(restoreTarget.createdAt) : '' }} 的配置吗？</p>
      <p v-if="restoreLoading" class="data-settings__dialog-hint">正在读取备份…</p>
      <p v-else-if="restoreSummary" class="data-settings__dialog-hint">包含：{{ restoreSummary }}</p>
      <p class="data-settings__dialog-hint">当前配置会先自动备份一份，恢复失败不会改动现有配置。</p>
      <template #footer>
        <Button variant="text" :disabled="busy" @click="restoreTarget = null">取消</Button>
        <Button :disabled="busy" @click="confirmRestore">{{ busy ? '恢复中…' : '恢复' }}</Button>
      </template>
    </Dialog>

    <Dialog :open="importOpen" label="导入配置" @update:open="importOpen = $event">
      <p class="data-settings__dialog-text">将导入 {{ importSummary }}，并整体替换当前配置。</p>
      <p class="data-settings__dialog-hint">导入前会自动备份当前配置；脱敏文件不会覆盖同名供应商已有的 API Key。</p>
      <template #footer>
        <Button variant="text" :disabled="busy" @click="importDraft = null">取消</Button>
        <Button :disabled="busy" @click="confirmImport">{{ busy ? '导入中…' : '导入' }}</Button>
      </template>
    </Dialog>
  </section>
</template>

<style scoped lang="scss" src="../../styles/components/preferences/DataSettings.scss"></style>
