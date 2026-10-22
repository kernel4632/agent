# UI 适配边界

页面和业务组件只从 `./index.js` 导入 `AppIcon`、`Button`、`Dialog`、`Field`、`IconButton`、`Select`、`Switch`、`avatarColor`、`initial`。

以后整体换到 KIMA 时，只需要在 `index.js` 把 `KimaButton` 等组件映射成现有名字，或者在页面里统一改一次 import，不再逐个文件搜索 `ui/*.vue`。

当前本地原语仍依赖 `base.scss` 的 `.button`、`.field`、`.select` 等基础样式。换库时必须连同这些基础样式一起替换，不能只替换 Vue 文件。

## 换库前还要收口的地方

- `Select` 的 `selectClass` 和页面里的 `:deep(.ui-select__input)`
- `Field` 的 `@change` 透传
- `Button` 的 `variant="plain"` 列表行皮肤
- `Composer.vue` 的工具栏和原生编辑器仍是该组件自己的布局
