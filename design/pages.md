# 页面、卡片与列表

返回 [DESIGN.md](../DESIGN.md)。

## 页面放在哪里

- 工作台壳 `WorkspaceShell.vue` 只放默认三栏写作面；其他整页经 `lazyAppComponents` 按需加载。
- 界面状态放 `stores/`，跨组件流程放 `composables/`，领域页面放 `features/` 或 `extras/`；业务写入留在 coordinator / Utility handler，页面组件不直接拼写入逻辑。
- 新的复杂页面（尤其“更多功能”下的分析、拆书、同步类）以设置页为视觉参照。

## 设置页

参考 `components/settings-page.css`。

- 两栏 grid：左 256px 侧栏（≤ 1100px 时 230px），右侧内容滚动。
- 侧栏：`--sidebar-surface` 底、右边 `--theme-line-soft`；返回按钮、搜索框、分类导航。分类项 `min-height: 34px`、圆角 7px，悬停 `--surface-hover`，当前项 `--surface-selected` + `--text-primary`；分节标签 `--text-tertiary`、小号、字重 620。
- 内容区：`padding: 52px clamp(42px, 7vw, 112px) 80px`，内宽最多 1060px 居中；页标题 2.57143rem、字重 520、下距 60px。
- 分组：最宽 760px，分组标题 1.07143rem / 640，下接设置卡片。
- 设置卡片：`--surface-raised` 底、`--theme-line-soft` 边、圆角 13px、上下 6px 内边距；卡片内每行 `.settings-item`（`padding: 14px 18px`，行间 `--theme-line-soft` 分隔），左侧标题 + 说明，右侧控件。
- macOS 下侧栏顶部留 40px 并作拖拽区，侧栏内控件 `no-drag`。

## “更多功能”分析页

参考 `extras/analysis-ui/AnalysisPageShell.vue` 与 `analysis-ui.css`。

- 外层 `.analysis-workbench`：`padding: 28px clamp(18px, 4%, 56px) 64px`，自身滚动，`container-type: inline-size`（内部按容器宽度做响应，不按窗口宽度）。
- 页眉：眉标（“更多功能”）+ h1（1.714286rem / 650）+ 一行说明；右侧放页级操作，窄时换行。最宽 1080px 居中。
- 内容：grid，卡片间距 `--analysis-gap`（16px），最宽 1080px。
- 卡片 `.analysis-card`：`--surface-raised` 底、`--theme-line-soft` 边、圆角 12px、padding 18px；卡头标题 1.142857rem / 600，右侧操作。
- 运行状态、模型设置、过程面板复用 `analysis-ui/` 下现成组件（`AnalysisRunStatus`、`AnalysisModelSettings`、`AnalysisProcessPanel`），不在页面里重写。

## 卡片与列表

- 信息卡片（目录卡、模型卡）：`--surface-raised` 底、`--theme-line` 边、圆角 10px、padding 12px，内部 grid：图标 / 文字 / 操作。
- 默认项或当前项：边框与底色混入强调色（边 22%、底 6%），不用强调色实心。
- 列表行：悬停 `--surface-hover`，选中 `--surface-selected`；行内操作按钮平时弱化，悬停或聚焦时显出。
- 列表与树的名称单行省略号截断（`min-width: 0` + `text-overflow: ellipsis`），悬停可见全名。
- 目录类页面用“列表 / 详情”拆分：左侧列表、右侧详情编辑，详情底部用吸底保存栏（见 [feedback.md](feedback.md)）。

## 滚动与尺寸

- 页面与弹窗内容区自己滚动，`html/body/#app` 不滚动。
- 滚动条 8px、透明轨道、`--theme-line` 圆角滑块；需要“滚动时才显示”的区域加 `transient-scrollbar`，并用 `utils/transientScrollbar.ts` 的控制器切换显示。
- 不写固定高度装文字；容器用 `min-height` + 内容撑开，大字号和窄窗口下检查换行与裁切。
- grid / flex 子项写 `min-width: 0`，避免长文本撑破布局。
