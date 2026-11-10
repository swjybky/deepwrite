# DeepWrite 界面设计

本文件写产品层面的设计约束、颜色体系与整体布局。具体控件的规范在 `design/` 下，做到相应元素时再读：

| 文件 | 何时读 |
| --- | --- |
| [design/tokens.md](design/tokens.md) | 需要具体的变量名、字号换算、间距圆角、层级 z-index、动效时长 |
| [design/buttons.md](design/buttons.md) | 新增或修改按钮、图标按钮、危险操作 |
| [design/forms.md](design/forms.md) | 输入框、文本域、下拉选择、开关、分段、选项卡片、表单排布 |
| [design/dialogs.md](design/dialogs.md) | 弹窗、确认框、Teleport 弹层 |
| [design/feedback.md](design/feedback.md) | toast、保存状态、加载与 pending、乐观更新、防闪烁 |
| [design/pages.md](design/pages.md) | 设置页、“更多功能”分析页、卡片、列表、底部保存栏 |
| [design/icons.md](design/icons.md) | 图标 |
| [design/copy.md](design/copy.md) | 界面文案与多语言 |

## 产品设计约束

- **写作优先，工具安静。**DeepWrite 是给小说与剧本作者长时间使用的桌面写作工具。正文区是主角，界面用中性色、细分隔线、低对比的层级来组织，不用大面积色块、渐变或装饰图形抢注意力。强调色只用于“当前选中 / 进行中 / 可点的关键处”。
- **四项基础能力是主流程：**创作空间、素材库、技能库、设置。侧边栏“更多功能”里的扩展页（聊天、拆书、分析、同步等）沿用同一套容器、控件与主题，不另起视觉风格。
- **智能体改稿必须可审阅。**智能体对文稿的修改先以差异提案展示，用户接受后才落盘；界面上要让“待审阅”“已接受”“已拒绝”清晰可辨，不把提案伪装成已完成的修改。
- **用户内容保持原样。**作品正文、用户命名、提示词、模型输出原样显示，不翻译、不截断语义（可省略号截断显示，悬停或展开能看到全文）。
- **跟随“设置 → 外观”。**主题模式、强调色、背景色、前景色、UI 字号、正文字号、字体、半透明侧边栏都会实时变化，所有界面（包括 `Teleport` 到 `body` 的弹层）都必须即时跟随，不写死颜色和像素字号。
- **桌面窗口约束：**最小窗口 1000 × 680；UI 字号 10–24px、正文字号 10–40px 都要能用。检查紧凑窗口和大字号下不裁切、不溢出，避免固定高度。
- **反馈不推挤布局。**临时的成功、错误、警告用 toast；只有必须用户确认才能继续的风险操作用模态确认（见 [design/feedback.md](design/feedback.md)）。
- **尊重减少动效。**全局已对 `prefers-reduced-motion` 关闭过渡与动画，新增动效不要绕开它。

## 颜色

颜色全部来自运行时主题变量。`composables/appearanceThemeRuntime.ts` 的 `applyAppearanceThemeToDocument` 只接收三种颜色——**背景色、前景色、强调色**——其余表面色、线色、文字色都按比例从背景向前景混合得到，所以任意主题下层级关系都成立。

| 用途 | 变量 | 说明 |
| --- | --- | --- |
| 页面底色 | `--surface-main` | 主内容区、对话区、弹窗底 |
| 抬升面 | `--surface-raised` | 卡片、编辑器、设置卡片 |
| 弱底 | `--surface-muted` | 输入组、提示块、只读字段、搜索框 |
| 悬停 / 选中 | `--surface-hover` / `--surface-selected` | 列表行、菜单项、导航项 |
| 侧边栏 | `--sidebar-surface` | 左栏与设置页侧栏，可能半透明 |
| 分隔线 | `--theme-line` / `--theme-line-soft` | 控件边框用前者，卡片内分隔与区块边用后者 |
| 文字 | `--text-primary` / `--text-secondary` / `--text-tertiary` | 正文与标题 / 说明 / 辅助与占位 |
| 强调 | `--accent` / `--accent-soft` / `--accent-contrast` | 选中、焦点、开关打开、链接；`soft` 作选中底；`contrast` 是压在实心色上的文字色 |
| 中性实心 | `--neutral-solid` | 主操作按钮底色 |
| 状态 | `--success` `--warning` `--danger` 及 `-soft`，`--danger-text` | 只用于状态与危险操作 |

规则：

- 普通容器只用上表变量，不另设固定色板；需要弱化或加深时用 `color-mix(in srgb, var(--x) N%, var(--y))` 在变量之间混合。
- 主操作在浅色主题下是**中性深色实心**（`--neutral-solid`），深色主题下由 `styles.css` 统一改为强调色实心；组件不要自己按主题切换。其他地方的强调色实心只用于开关打开、进度、小面积标识。
- 红色只表示删除持久数据或不可恢复的覆盖；警告色只表示需要注意但可继续。
- 阴影用 `--shadow-color` 或带透明度的黑色，深色主题下自然变弱；不要用彩色阴影。
- 检查浅色、深色、内置预设（Codex、暖纸、海雾、护眼）和自定义强调色下的对比度。

## 布局

### 工作台三栏

`WorkspaceShell.vue` 是工作台壳，`.desktop-shell` 为三列 grid：

```
┌────────────┬──────────────────────────┬──────────────────┐
│ 左栏 286px  │ 中栏 ≥ 320px，自适应       │ 右栏 410–650px    │
│ 导航与目录   │ 智能体对话                 │ 正文编辑与预览     │
│ sidebar     │ surface-main              │ surface-raised    │
└────────────┴──────────────────────────┴──────────────────┘
```

- 宽度由 `--left-pane-width`、`--center-pane-min`、`--right-pane-width` 控制；窗口宽度 ≤ 1220px 时左栏 262px、右栏 395px。两侧可拖拽、可折叠（`is-left-collapsed` / `is-right-collapsed`），列宽变化有 180ms 过渡，拖拽时关闭过渡。
- 默认写作面留在壳内；其他领域界面（设置、素材库、技能库、“更多功能”各页）经 `lazyAppComponents` 按需加载，替换主区域，不在三栏内塞整页。
- macOS 顶部为窗口拖拽区（`-webkit-app-region: drag`），区内可点控件必须设 `no-drag`。

### 整页

- **设置页**是复杂页面的参照：左侧 256px 分类导航 + 右侧滚动内容，内容最宽 1060px、分组最宽 760px，分组标题 + 圆角卡片 + 卡片内分隔行。
- **“更多功能”分析页**用 `AnalysisPageShell`：页眉（眉标、标题、说明、右侧操作）+ 内容 grid，最宽 1080px 居中，卡片之间 16px。
- 细节见 [design/pages.md](design/pages.md)。

### 弹窗

居中模态，默认宽 `min(560px, 100vw - 48px)`，最高 `min(720px, 100vh - 60px)`，头部 / 可滚动内容 / 底部操作三段式，见 [design/dialogs.md](design/dialogs.md)。

## 样式代码放哪里

- 全局样式入口是 `renderer/src/styles.css`：主题变量、工作台壳、按钮、弹窗、表单、对话与外观主题覆盖层都在这里。`renderer/src/styles/` 下的文件要么由 `styles.css` `@import`，要么由对应组件引入。
- 新拆出的样式文件必须接入（`@import` 或组件 `import`）并同时删除 `styles.css` 里的原规则，不留未引用的副本——未引用的 CSS 不会生效。
- 新组件优先用 `<style scoped>` 或同目录的组件 CSS 文件；全局类名要带领域前缀，避免与 `tree-*` 这类已有全局类冲突。
