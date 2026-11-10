# 按钮

返回 [DESIGN.md](../DESIGN.md)。全局类定义在 `renderer/src/styles.css`。

## 种类

| 种类 | 类名 | 外观 | 用途 |
| --- | --- | --- | --- |
| 主操作 | `.dialog-primary-button` | `--neutral-solid` 实心，文字 `--accent-contrast`；深色主题自动改为 `--accent` 实心 | 保存、创建、确认、开始运行 |
| 次操作 | `.dialog-secondary-button` | `--surface-main` 底 + `--theme-line` 边，文字 `--text-secondary`；悬停底 `--sidebar-surface` | 取消、返回、次要动作 |
| 危险 | `.dialog-primary-button.is-danger` | `--danger` 实心 | 删除持久数据、不可恢复的覆盖 |
| 图标按钮 | `.icon-button` | 32×32，透明底，文字 `--text-secondary`；悬停 `--surface-hover` + `--text-primary` | 工具栏、行内操作、关闭 |
| 文字链接 | 无全局类，参照 `.toast-message__action` | 无底无边，`--accent` 文字，悬停下划线（offset 3px） | 弱操作、打开说明、跳转设置 |

- 尺寸：`min-height: 32px`，`padding: 0 12px`，圆角 7px，字号 `0.785714rem`，图标与文字 gap 6px，图标 15–16px。
- 一组操作右对齐（`.dialog-actions`：`justify-content: flex-end; gap: 7px`），主操作放最右，一组里只有一个主操作。
- 组件内用 scoped 的 `.primary-button` / `.secondary-button` 时，外观必须与上表一致（如 `AgentTeamSaveBar.vue`），不要另起颜色或尺寸。

## 选择规则

- “只清空临时内容”的操作（重新开始一次分析、清空输入）用普通主操作或次操作，**不用**红色。
- 红色按钮只出现在确认弹窗或明确的删除入口；列表行里的删除图标平时为中性色，悬停才显出危险色。
- 不用强调色实心做普通按钮；强调色只给选中态和链接。

## 状态

- `:disabled`：`opacity: 0.5`，`cursor: not-allowed`；不改颜色、不改尺寸。
- 焦点：全局 `:focus-visible` 为 2px 强调色描边（55% 混合，offset 1px），不要去掉 outline。
- 进行中：只改触发它的按钮——文案换成“保存中…”之类并禁用这一个按钮，尺寸不跳动（必要时给最小宽度）。不要因此禁用整页其他控件，见 [feedback.md](feedback.md)。
- 每个 `<button>` 写 `type="button"`（表单提交按钮除外）；只有图标的按钮必须有 `aria-label` 或 `title`，文字经 i18n。
