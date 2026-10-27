# 前端 HOP 重构计划

这个文件给后续接手的子智能体看：当前前端能正常用，但布局和控件直接写在大文件里，换成自研组件库会很费劲。目标是在不改变行为的前提下，把“外壳、视图、UI 控件、主题”分开。

调用示例：子智能体先读本文件，再读要改的源文件和 `tests/ui-audit.spec.js`，只做当前阶段，不跨阶段顺手改。

## 目标

- 换组件库时只改 `src/ui/` 和 `src/theme/`，不改业务页面。
- 改布局时只改对应视图和 `src/styles/tokens.scss`，不在一堆页面里找写死的尺寸。
- 新增/删除一个设置页，只动 `src/settings/pages.js` 和对应页面文件。
- `App.vue` 只保留外壳和视图切换，目标 200 行以内。
- 删除已经不用的文件和测试，减少接手者的干扰。
- 全部行为保持不变；`bun run test`、`bun run build`、`bun run test:ui` 必须通过。

## 不做什么

- 不改后端接口和数据格式。
- 不换 Vue、不引入原子化 CSS、不引入新依赖。
- 不重写业务逻辑，只搬家和加适配层。
- 不改现有测试断言的用户可见文案，除非文案本身是错误。

## 目标目录

```text
src/
  app/           外壳：Titlebar、TabStrip、CommandPalette、Toast
  home/          首页：项目、会话列表
  draft/         新会话页
  session/       会话页：顶部、时间线、输入区、文件面板
  settings/      设置页：导航、页面登记表、各页面
  ui/            组件库适配层：Button、IconButton、Field、Switch、Dialog、Menu
  theme/         主题适配层：现在接 M3E，未来接自研主题
  styles/        tokens、base、mixins
  utils/         通用小工具
  api.js         后端 HTTP 契约
  config.js      配置读取和转换
  defaults.js    前端默认值
  workspace.js   工作区状态
  store.js
```

`ui/` 不是业务层，只负责把“按钮、输入框、下拉框、开关、弹窗”包成稳定接口。普通按钮、文本输入、下拉框和开关必须走 `ui/`；编辑器、文件选择、复选/单选等专用控件在对应组件到位前可以保留原生实现，但要在文件头注明原因。自研组件库到位后，替换 `ui/` 里的实现即可。

## UI 控件接口

先按这些接口写，页面迁移时再逐步用上。不要提前创建没人用的控件。

> 后续变更：下拉框已改为直接使用 KIMA 的 `KimaSelect`，`src/ui/Select.vue` 已删除；下表保留当时的接口记录。

| 控件 | 必要 props | 事件 / 插槽 |
|---|---|---|
| `Button.vue` | `variant`（default/primary/danger/ghost/plain）、`size`（normal/small）、`disabled`、`type` | `click`，默认插槽 |
| `IconButton.vue` | `label`、`title`、`size`（normal/small）、`active`、`disabled`、`type` | `click`，默认插槽放图标 |
| `Field.vue` | `modelValue`、`type`、`placeholder`、`label`、`caption`、`disabled`、`multiline`、`rows`、`size`（normal/small） | `update:modelValue`，`leading` / `trailing` 插槽 |
| `Select.vue` | `modelValue`、`options`、`label`、`caption`、`disabled`、`size`（normal/small）、`selectClass` | `update:modelValue` |
| `Switch.vue` | `modelValue`、`label`、`disabled` | `update:modelValue` |
| `Dialog.vue` | `open`、`label` | `update:open`，默认插槽 |

`UiMenu`、搜索框、编辑器、文件选择、复选/单选控件还没抽成通用组件；需要时再加，不提前造空壳。

## 阶段

状态用 `[ ]` / `[x]` 更新。每阶段只做自己那一段，不顺手搬到下一阶段。

### [x] 阶段 1：外壳和图标按钮

- 新建 `src/ui/IconButton.vue`，把标题栏里的图标按钮换进去。
- 新建 `src/app/Titlebar.vue` 和 `src/app/TabStrip.vue`。
- `Titlebar` 负责频道徽标、主页、标签、命令面板和设置入口；标签标题和颜色在组件内部从 `store` 算，不从 `App.vue` 传一堆派生值。
- `App.vue` 只保留标题栏的事件处理和当前视图切换。
- 保留现有 `aria-label`、按钮角色、可点击区域；界面测试不能改断言。
- 验收：标题栏模板块完整移出，`App.vue` 净减 70 行以上；标题栏部分不再有裸 `<button>`；构建、单测、UI 全过。

### [x] 阶段 2：命令面板和提示条

- 新建 `src/app/CommandPalette.vue`，把查询、选中项、方向键、回车、Esc 收进组件。
- `App.vue` 只保留“打开/关闭、命令列表、执行命令”。
- 新建 `src/app/Toast.vue`，提示条从 `App.vue` 移出。
- 验收：命令面板和提示条的行为、`role`、`aria-label` 不变；`App.vue` 继续变薄。

### [x] 阶段 3：首页

- 新建 `src/home/HomeView.vue`、`ProjectList.vue`、`SessionList.vue`。
- 项目列表、会话搜索、会话菜单、重命名/删除弹窗各归自己的文件。
- 新建 `src/ui/Button.vue`、`Field.vue`、`Dialog.vue`，首页先用起来。
- 删除旧 `src/components/HomePage.vue`。
- 验收：`.home-panel`、`.home-session`、搜索框和菜单角色不变；桌面和手机都通过。

### [x] 阶段 4：新会话页

- 新建 `src/draft/DraftView.vue`，把字标、输入区、项目路径从 `App.vue` 移出。
- 组件只接收工作区、模型和发送事件；创建会话仍在 `App.vue` 或 `src/session/session.js`。
- 验收：草稿页截图、发送、附件、模型选择不变。

### [x] 阶段 5：会话页

拆成三个小步，每步单独审查和提交。

#### [x] 5a：移动共享输入区和时间线

- `ChatComposer.vue` 移动到 `src/composer/Composer.vue`。
- `ConversationFlow.vue` 移动到 `src/session/Timeline.vue`。
- 更新 App、DraftView 的 import；组件行为、class、测试断言不变。
- 验收：构建、单测、UI 全过。

#### [x] 5b：拆会话顶部和文件面板

- 新建 `src/session/SessionHeader.vue`、`src/session/SessionFilePanel.vue`。
- 顶部负责标题、项目图标、模型选择、复制、分支、文件面板开关。
- 文件面板负责本次改动文件和工作区文件列表，自己读 `session` / `workspace`。
- App 只保留 `reviewOpen` 和事件接线，或把开关状态放进会话组件。
- 验收：会话页测试通过；`App.vue` 不再出现文件面板模板和样式。

#### [x] 5c：拆整个会话视图

- 新建 `src/session/SessionView.vue`，组合顶部、时间线、输入区、文件面板、重连提示和自动批准面板。
- 模型切换、按用途选模型、自动批准、文件列表都收进会话视图。
- `App.vue` 只保留 `<SessionView :session="session" :workspace="selectedWorkspace" />`。
- 验收：`App.vue` 不再出现会话正文、输入区和设置面板；会话页所有测试通过。

### [x] 阶段 6：设置页登记表

- 新建 `src/settings/pages.js`，一个数组登记页面：`id`、`label`、`icon`、`group`、`component`。
- 新建 `src/settings/SettingsNav.vue`，导航只读登记表。
- 设置内容用动态组件渲染；每个页面一个包装文件，负责把 `draft` 的对应字段接到原设置组件。
- 删除 `SettingsNavigation.vue`、`SettingsPlaceholder.vue`、`register.js`。
- 验收：新增/删除一个设置页只改登记表和一个页面文件；现有设置测试全过。

### [x] 阶段 7：把设置页控件换到 ui/

拆成三个小步，每步单独审查和提交。

#### [x] 7a：补下拉/开关控件，迁移设置外壳、导航、外观和提示词

- 新建 `src/ui/Switch.vue`；`Select.vue` 等 7b 真正用到时再建，避免提前造没人用的控件。
- `Button.vue` 增加 `plain` 变体，给导航项和列表项使用；尺寸和交互仍由调用方现有样式负责。
- 设置外壳的关闭/保存、导航返回/分组项、“添加供应商”换到 `IconButton` / `Button`。
- 外观页的开关换到 `Switch`，恢复默认换到 `Button`；主题和颜色单选框暂留，等组件库有对应选择控件再换。
- 提示词 textarea 换到 `Field multiline`。
- 验收：设置外壳、导航、外观、提示词行为不变，构建、单测、UI 全过。

#### [x] 7b：迁移高级、工具和 MCP 页

- 高级页的输入框、数字框、开关、JSON textarea、应用按钮换到 `Field` / `Switch` / `Button`。
- 工具页的权限下拉和开关换到 `Select` / `Switch`。
- MCP 页的列表按钮、添加/删除按钮、输入框、下拉框、textarea、开关换到 `Button` / `Field` / `Select` / `Switch`。
- 验收：数字转换、JSON 解析、删除确认和权限联动不变，UI 全过。

#### [x] 7c：迁移供应商页并扫描

- 供应商列表、编辑器、模型列表的按钮、输入框、下拉框、开关全部换到 `ui/`。
- 删除确认弹窗里的按钮换到 `Button`；原生 dialog 元素暂留，等 `Dialog` 支持受控开关后再换。
- 扫描 `src/settings`，普通按钮/文本输入/下拉框/开关不再直接出现；主题/颜色单选、列表选中项若没有对应控件，记录为下一阶段组件库缺口。
- 验收：供应商增删改、模型发现/添加/移除、API Key 显示切换不变，UI 全过。

### [x] 阶段 8：主题和样式收口

#### [x] 8a：主题适配层

- 新建 `src/theme/ThemeProvider.vue`、`theme/m3e.js`，把 M3E 属性、accent、token 同步和系统主题监听从 `App.vue`、`watchers.js` 移进去。
- `theme.js` 移到 `theme/index.js`，App 不再直接接触 M3E。
- 验收：主题切换、深色/浅色/跟随系统、减少动画、强焦点和 token 同步保持，UI 全过。

#### [x] 8b：样式 token 和死文件清理

- 把布局尺寸、内容宽度、settings 导航宽度收进 `tokens.scss`；去掉 `280px`、`860px`、`720px` 这类重复值。
- 把遗留的 `var(--md-sys-color-outline)`、硬编码错误色换成 `--la-*`。
- 删除 `Sidebar.vue`、`ToolExpansion.vue` 和 7 个不跑的旧 spec；清掉 sidebar 相关死状态、命令和 i18n 文案。
- 验收：没有未引用文件；构建、单测、UI 全过。

#### [x] 8c：目录收口和 App 瘦身

- 把设置组件移到 `src/settings/components/`，把 `SettingsPage.vue` 移到 `src/settings/`，设置页只在 `settings/` 下。
- 把 `AppIcon.vue` 移到 `src/ui/`，`components/` 只剩真正共享的组件或删除。
- 把连接错误条和全局快捷键从 `App.vue` 移到 `src/app/`，目标 200 行以内。
- 给新组件补文件头：管什么、怎么调用、调用示例；业务步骤补注释。
- 验收：`App.vue` 200 行以内；构建、单测、UI 全过。

### [x] 阶段 9：最终审查

- 按 HOP 的五个问题逐项检查：找得到、敢改、加一个同类只放一个文件、删一个干净、零上下文能接手。
- 检查 `ui/` 是否是唯一组件库入口，`theme/` 是否是唯一主题入口，设置页是否只有一个登记点。
- 更新本文件的勾选状态。
- 跑完整验证并提交推送。

#### 审查结果

- `App.vue` 189 行，只保留主题、标题栏、视图切换、草稿创建和跨视图接线。
- 普通按钮、文本输入、下拉框、开关都走 `ui/`；`Button.vue`、`IconButton.vue`、`Field.vue`、`Select.vue`、`Switch.vue`、`Dialog.vue`、`AppIcon.vue` 是唯一入口。
- `theme/` 只有 `ThemeProvider.vue` 一个 `m3e-theme` 包装；`watchers.js` 不再接触主题。
- 设置页只有一个登记表 `settings/pages.js`；设置壳、导航、页面包装和原设置组件都在 `settings/` 下。
- 还保留的原生专用控件：命令面板搜索框、Composer 编辑器/隐藏文件框、时间线回退复选框、外观主题/颜色单选框。文件头已注明原因，等对应编辑器/选择组件到位再替换。
- 验证：前端 `bun run test` 11/11、`bun run build`、`bun run test:ui` 30/30；后端 `bun test` 170/170。

## 每个阶段的审查门

1. 子智能体先说明改了哪些文件、为什么，不提交。
2. 主智能体看 diff：有没有跨阶段改动、行为变化、重复样式、裸控件、无用文件、缺失文件头。
3. 跑 `bun run build`、`bun run test`；阶段 1、3、4、5、6、7、8 还要跑 `bun run test:ui`。
4. 问题退回同一个子智能体会话，附具体文件和行号；修完再跑一遍。
5. 通过后才改版本号、提交、推送，并更新本文件状态。
