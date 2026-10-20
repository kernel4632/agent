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
  ui/            组件库适配层：Button、IconButton、Field、Select、Switch、Dialog、Menu
  theme/         主题适配层：现在接 M3E，未来接自研主题
  commands/      业务指令，保持现状
  styles/        tokens、base、mixins
  utils/         通用小工具
  api.js
  store.js
```

`ui/` 不是业务层，只负责把“按钮、输入框、下拉框、开关、弹窗”包成稳定接口。页面只 import `ui/`，不直接写原生控件。自研组件库到位后，替换 `ui/` 里的实现即可。

## UI 控件接口

先按这些接口写，页面迁移时再逐步用上。不要提前创建没人用的控件。

| 控件 | 必要 props | 事件 / 插槽 |
|---|---|---|
| `UiButton.vue` | `variant`（default/primary/danger/ghost）、`size`（normal/small）、`disabled`、`type` | `click`，默认插槽 |
| `UiIconButton.vue` | `label`、`title`、`size`（normal/small）、`active`、`disabled`、`type` | `click`，默认插槽放图标 |
| `UiField.vue` | `modelValue`、`type`、`placeholder`、`label`、`disabled`、`multiline`、`rows` | `update:modelValue`，`leading` / `trailing` 插槽 |
| `UiSelect.vue` | `modelValue`、`options`、`label`、`disabled` | `update:modelValue` |
| `UiSwitch.vue` | `modelValue`、`label`、`disabled` | `update:modelValue` |
| `UiDialog.vue` | `open`、`title`、`label`、`fit` | `update:open`，默认插槽，`actions` 插槽 |
| `UiMenu.vue` | `label`、`items` 或默认插槽 | `select` |

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
- 组件只接收工作区、模型和发送事件；创建会话仍在 `App.vue` 或 `commands/session.js`。
- 验收：草稿页截图、发送、附件、模型选择不变。

### [ ] 阶段 5：会话页

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

### [ ] 阶段 7：把设置页控件换到 ui/

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

### [ ] 阶段 8：主题和样式收口

- 新建 `src/theme/ThemeProvider.vue`，把 `m3e-theme` 的属性设置、accent 写入和 token 同步从 `App.vue`、`watchers.js` 移进去。
- 把布局尺寸、头像色、内容宽度收进 `tokens.scss`；页面里不再写 `280px`、`860px`、`720px`、`#3250df` 这类值。
- 删除 `Sidebar.vue`、`ToolExpansion.vue` 和 7 个不跑的旧 spec。
- 给所有新组件补文件头：管什么、怎么调用、调用示例；脚本里的业务步骤补注释。
- 验收：`App.vue` 200 行以内；没有未引用文件；构建、单测、UI 全过。

### [ ] 阶段 9：最终审查

- 按 HOP 的五个问题逐项检查：找得到、敢改、加一个同类只放一个文件、删一个干净、零上下文能接手。
- 检查 `ui/` 是否是唯一组件库入口，`theme/` 是否是唯一主题入口，设置页是否只有一个登记点。
- 更新本文件的勾选状态。
- 跑完整验证并提交推送。

## 每个阶段的审查门

1. 子智能体先说明改了哪些文件、为什么，不提交。
2. 主智能体看 diff：有没有跨阶段改动、行为变化、重复样式、裸控件、无用文件、缺失文件头。
3. 跑 `bun run build`、`bun run test`；阶段 1、3、4、5、6、7、8 还要跑 `bun run test:ui`。
4. 问题退回同一个子智能体会话，附具体文件和行号；修完再跑一遍。
5. 通过后才改版本号、提交、推送，并更新本文件状态。
