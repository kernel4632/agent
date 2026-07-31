<!--
权限编辑组件：按工具显示 allow、ask、deny 三态选择，并返回新的 permissions 对象。
模式匹配对象保持只读提示，避免简化表单破坏用户的细分规则。
调用示例：<PermissionEditor :permissions="draft.permissions" @update="setPermissions" />。
-->
<script setup>
import { computed } from 'vue'                       // 引入真实工具与已配置规则合并能力

const props = defineProps({                           // 声明当前权限映射
  permissions: { type: Object, required: true },      // 工具名到权限值或规则对象的映射
  toolNames: { type: Array, default: () => [] },       // Server 当前注册的全部工具名称
})

const emit = defineEmits(['update'])                  // 将完整权限副本交回设置页
const permissionEntries = computed(() => [...new Set([...props.toolNames, ...Object.keys(props.permissions)])].sort().map((toolName) => [toolName, props.permissions[toolName] ?? 'ask'])) // 未配置工具也以真实默认值显示


// --- 修改简单权限 ---
function updatePermission(toolName, permission) {
  emit('update', { ...props.permissions, [toolName]: permission }) // 只替换用户选择的工具规则
}
</script>

<template>
  <section class="settings-section">
    <header class="settings-section__header">
      <h2>工具权限</h2>
      <p>未配置工具默认为每次询问。</p>
    </header>
    <div class="permission-list">
      <div v-for="[toolName, permission] in permissionEntries" :key="toolName" class="permission-row">
        <div>
          <strong>{{ toolName }}</strong>
          <small v-if="typeof permission === 'object'">包含参数匹配规则</small>
        </div>
        <mdui-segmented-button-group v-if="typeof permission === 'string'" selects="single" :value="permission" @change="updatePermission(toolName, $event.target.value)">
          <mdui-segmented-button value="allow">允许</mdui-segmented-button>
          <mdui-segmented-button value="ask">询问</mdui-segmented-button>
          <mdui-segmented-button value="deny">拒绝</mdui-segmented-button>
        </mdui-segmented-button-group>
        <code v-else>{{ Object.keys(permission).length }} 条规则</code>
      </div>
    </div>
  </section>
</template>
