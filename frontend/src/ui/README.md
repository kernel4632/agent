# 项目自有 UI

页面只从 `src/ui/index.js` 导入控件。控件的结构、事件与临时状态写在 `ui/*.vue`，外观写在 `styles/ui/*.scss`。两者同名、一一对应，Vue 用外部 `<style scoped lang="scss" src="…">` 关联样式。

## 找到要改的地方

| 内容 | 文件 |
| --- | --- |
| 动作按钮、图标按钮 | `Button.vue`、`IconButton.vue`；按压反馈在 `press.js` |
| 输入、密码可见、清空 | `Field.vue` |
| JSON 草稿与完整对象校验 | `JsonInput.vue` |
| 数字、滑块、开关、勾选 | `NumberField.vue`、`Slider.vue`、`Switch.vue`、`Checkbox.vue` |
| 单选、多选 | `RadioGroup.vue`、`CheckboxGroup.vue` |
| 下拉框、菜单、统计弹层 | `Select.vue`、`MenuButton.vue`、`Popover.vue`；顶层定位在 `usePopup.js` |
| 居中弹窗、侧面抽屉 | `Dialog.vue` 的 `placement="center/left/right"` |
| 底部选择面板 | `Sheet.vue`：设置 `Dialog` 的底部位置和宽度 |
| 富文本与代码 | `Markdown.vue`、`CodeBlock.vue`、`SmoothMarkdown.vue` |
| 颜色、尺寸、动画 | `styles/tokens.scss`；动态颜色计算在 `theme/palette.js` |

## 使用示例

```vue
<script setup>
import { ref } from 'vue'
import { Button, Dialog, Field } from '../ui/index.js'
const open = ref(false)
const name = ref('')
</script>

<template>
  <Button @click="open = true">编辑</Button>
  <Dialog v-model:open="open" label="编辑名称">
    <Field v-model="name" label="名称" clearable />
  </Dialog>
</template>
```

## 行为约定

- 表单控件发出 `update:modelValue`；滑块的 `change` 在松手时提交。JSON 只有完整对象或空文本才发 `change`，未完成输入留在本地。
- `Dialog` 使用原生模态对话框处理焦点、Tab 循环和焦点归还。始终挂载，让关闭动画有时间完成；Escape 与遮罩发出 `update:open=false`。
- `Select` 只暴露一个组合框。方向键、Home/End、字符搜索和 Enter 选择均可用。菜单按方向键移动，Escape 关闭并把焦点还给触发按钮。
- 浮层使用原生 Popover API，避免被滚动区域裁剪。主题写在 `html`，因此顶层弹窗也能继承颜色和减少动画设置。
- 公共尺寸：Field 64px（small 48px）、动作按钮 56px、图标按钮 48px。页面控制布局，公共控件 SCSS 控制外观。
- 新组件必须配同名 SCSS，并从 `index.js` 导出；无专属样式的组合组件也保留对应文件作为修改入口。

运行 `bun run test` 检查组件边界与样式对应关系，`bun run test:ui` 验证键盘、弹层、设置和聊天流程，`bun run build` 验证生产构建。
