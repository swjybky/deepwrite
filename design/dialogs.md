# 弹窗

返回 [DESIGN.md](../DESIGN.md)。全局类定义在 `renderer/src/styles.css`。

## 何时用

- 需要集中填写的创建 / 编辑流程，或必须由用户确认才能继续的风险操作。
- 普通提示、成功、可忽略的错误不用弹窗，用 toast。
- 能在页面内完成的设置不要再开弹窗；弹窗内不再嵌套第二层弹窗，确需时用二级层级（见下）。

## 结构

```
.dialog-backdrop            遮罩，fixed 全屏居中，padding 30px
└ .workspace-dialog         圆角 15px，--surface-main，--theme-line 边，大阴影
  ├ header                  眉标（可选）+ h2 标题 + .dialog-close；下边 --theme-line-soft
  ├ .dialog-content         可滚动区，padding 20px 22px 23px
  │   .dialog-description   说明文字，--text-secondary，0.857143rem，行高 1.65
  │   .dialog-note          弱提示块，--surface-muted 底，圆角 8px
  └ .dialog-actions         右对齐操作，gap 7px
```

- 宽度：默认 `min(560px, 100vw - 48px)`；窄弹窗 430–500px；宽表单（模型配置）820px。最大高度 `min(720px, 100vh - 60px)`，内容区自己滚动，头部和操作区固定。
- 遮罩：浅色为前景色 28% 混合 + `blur(2px)`，深色为 `rgb(0 0 0 / 0.56)`。
- 关闭按钮 `.dialog-close`：30×30，圆角 7px，`--text-tertiary`，悬停 `--surface-hover`。
- 眉标 `.dialog-eyebrow`：`--text-tertiary`、0.642857rem、大写、字距 0.11em。

## 确认框

- 标题直接写要做的事（“删除这一节？”），说明里写清楚影响范围以及能否恢复。
- 危险确认：主按钮 `.dialog-primary-button.is-danger`，文案是具体动作（“删除”而非“确定”）；取消在左。
- 危险说明块用 `--danger` 8% 混合底 + 28% 混合边 + `--danger-text` 文字，参考 `.book-remove-warning`。
- 可恢复的删除（移入回收站）也要说明去向。

## 交互

- 打开时焦点进入弹窗（首个字段或主按钮），`Esc` 关闭，关闭后焦点回到触发处。
- 有未保存输入时，关闭前先确认是否放弃（参照智能体团队页的“放弃未保存的更改？”）。
- 提交中只禁用主按钮并换文案，弹窗不变灰、不换内容。
- 弹窗高度在提交、报错时不得变化：错误走 toast，不插到表单和按钮之间。

## Teleport 与层级

- 弹窗和弹层 `Teleport` 到 `body` 后脱离组件的 scoped 上下文，样式必须只依赖根节点主题变量，不依赖父容器的类。
- 工作台弹窗遮罩 z-index 100；二级弹窗 2100–2400；其内菜单要再高。新弹层按 [tokens.md](tokens.md) 的层级表取值。
- 弹窗里的 `PopupSelect` 菜单不得被弹窗裁切或压在弹窗下面。

## 作品管理

- 短篇、剧本、长篇、剧本杀和学术共用 `BookManagementDialog`。尺寸固定为 `width: min(960px, calc(100vw - 48px))` 与 `height: min(680px, calc(100vh - 48px))`。右侧内容独立滚动，分区超出时左栏独立滚动。
- 各作品传入 `{ id, group, label, title?, description? }[]`，导航按结构、设置、上下文分组，省略空组。子弹窗使用 `book-management-child` 层级，主弹窗保持原位并进入 `inert` 状态。
