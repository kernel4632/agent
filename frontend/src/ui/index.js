/*
 * UI 原语出口：页面只从这里拿 Button、Field、Icon 等基础组件。
 *
 * 现在这些组件由本地 src/ui 实现；以后换 KIMA 组件库时，只改这个文件的导出，
 * 页面和业务组件不需要逐个改 import。组件内部样式也应尽量留在这个边界内。
 * 调用示例：
 *   import { AppIcon, Button, Field } from '../ui/index.js'
 */

export { default as AppIcon } from './AppIcon.vue'
export { default as Button } from './Button.vue'
export { default as Dialog } from './Dialog.vue'
export { default as Field } from './Field.vue'
export { default as IconButton } from './IconButton.vue'
export { default as Select } from './Select.vue'
export { default as Switch } from './Switch.vue'
export { avatarColor, initial } from './avatar.js'
