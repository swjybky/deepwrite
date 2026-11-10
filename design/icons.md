# 图标

返回 [DESIGN.md](../DESIGN.md)。

- 统一用 `components/AppIcon.vue`：`<AppIcon name="save" :size="15" />`。图标是 24×24 视框的线性描边（`stroke="currentColor"`、线宽 1.8、圆角端点），颜色跟随文字色。
- 可用名称见 `types/workspace.ts` 的 `IconName`。新增图标在 `AppIcon.vue` 加一个 `v-else-if` 分支并补进 `IconName`，保持同样的视框、线宽和线性风格；不要引入图标字体、第三方图标库或彩色图标。
- 尺寸：按钮内 14–16px（最常用 16、15），工具栏与导航 16–18px，空状态或大入口 20–22px；默认 18px。
- 颜色：平时 `--text-secondary`，悬停或激活 `--text-primary`，状态图标用对应状态色；不给图标单独设固定色。
- 图标默认 `aria-hidden`。只有图标的按钮由按钮本身提供 `aria-label` / `title`（文字经 i18n）。
- 图标与文字 gap 5–6px，垂直居中；需要旋转的方向图标用 `transform` 处理（如设置页返回箭头复用 `chevron` 旋转 180°）。
