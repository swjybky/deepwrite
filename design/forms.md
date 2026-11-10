# 表单控件

返回 [DESIGN.md](../DESIGN.md)。

## 字段排布

- 字段 = 标签 + 控件，纵向 grid，gap 5–6px。标签 `0.785714rem`、`--text-secondary`、字重 ~570。
- 两列表单用 `grid-template-columns: repeat(2, minmax(0, 1fr))`，gap `11px 12px`；占满整行的字段加 `is-wide`（`grid-column: 1 / -1`）。参考 `.model-form-grid`。
- 字段说明可以作为稳定的辅助文案放在控件下方（`--text-tertiary`，小号）；**临时错误和警告不放在表单里**，用 toast（见 [feedback.md](feedback.md)）。
- 必填、格式校验在提交时用 toast 提示，并把焦点移到出问题的字段。

## 输入框与文本域

| 属性 | 普通 | 紧凑（表单网格内） |
| --- | --- | --- |
| 高度 | 38px | 34px |
| 内边距 | `0 11px` | `0 9px` |
| 圆角 | 8px | 7px |
| 字号 | 0.857143rem | 0.785714rem |

- 边框 `--theme-line`，底 `--surface-main`，文字 `--text-primary`，占位 `--text-tertiary`。
- 聚焦：边框换为强调色（或 `color-mix(var(--accent) 28%, var(--theme-line))`），加 `box-shadow: 0 0 0 3px var(--accent-soft)`；`outline: 0`。
- 只读：底 `--surface-muted`，文字 `--text-secondary`。
- 文本域：`padding: 12px`，圆角 9px，`resize: vertical`；承载作品正文或提示词时用 `--editor-font`、行高 1.7。
- 搜索框：无边框，`--surface-muted` 底、圆角 8px，左侧放图标，参考 `.settings-search`。
- 路径、版本号、模型 ID 用 `--code-font` + `--code-font-size`，单行省略号截断。

## 下拉选择

- 列表选择一律用 `components/PopupSelect.vue`，**不用原生 `<select>`**。
- `variant`：`field`（表单字段，默认）/ `compact`（工具栏）/ `preset` / `menu`；`size`：`small` / `medium` / `large`。必须传 `accessibleLabel`。
- 菜单 `Teleport` 到 `body`，默认 `menuZIndex` 1000；放在弹窗里时设 `:menu-z-index` 高于弹窗遮罩（见 [tokens.md](tokens.md) 层级表）。
- 选项可带 `group` 分组；多选用 `multiple` + `selectedValues`，触发器显示 `selectedSummary`。
- 树形选择（技能树）用 `SkillTreeSelect.vue`。

## 开关

- 用受控开关组件：`AgentTeamSwitch.vue`（36×20）或设置项里的 `.settings-toggle`（42×24）。关闭为 `--surface-selected` 底，打开为 `--accent` 底，滑块 `--surface-main` 带细阴影，150ms 过渡。
- 显示值只来自数据（`:checked="modelValue"`），`change` 只上报请求，`nextTick` 后把 DOM 对齐回数据；不要用 `preventDefault` 抢状态。保存逻辑按乐观更新处理，见 [feedback.md](feedback.md)。
- 必须有 `role="switch"` 和可读标签。

## 分段控件

- 2–4 个互斥选项用 `AgentTeamSegmented.vue` 的样式：外框 3px 内边距、`--theme-line` 边、圆角 10px；选项 `min-height: 30px`、圆角 7px；选中为 `--accent-soft` 底 + `--text-primary`。
- 原生 radio 视觉隐藏但保留可聚焦，焦点描边画在 label 上（`:has(input:focus-visible)`）。

## 选项卡片

- 带说明的单选或多选（如新建作品类型、绑定方式）用卡片：`--theme-line` 边、圆角 9–10px、`--surface-raised` 底；悬停 `--surface-muted`；选中边框与底色混入强调色（边约 22–35%、底约 6–8%）。
- 原生 checkbox / radio 保留，`accent-color: var(--text-primary)`，15px。

## 禁用

- 禁用控件 `opacity: 0.5–0.55` + `not-allowed`，不改布局。只禁用确实不能操作的那个控件。
