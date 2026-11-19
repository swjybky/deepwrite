# 编辑区工具栏层级与标题留白

## 目标与成功标准

- 关联文件独占上排，编辑／预览和操作按钮在下排。无关联文件的阶段直接显示操作栏。
- 各类作品的普通文稿标题距上方工具栏 14 px。学术资料卡以卡片工具栏底边为准。

## 环境

macOS Electron 42.5.0，临时用户目录、真实 Vue 组件和合成文稿。截图为编辑区裁切，窗口分别为 1200 × 850、UI 14 px 与 1000 × 680、UI 24 px。窄栏测试宽度 280 px。

## 步骤与命令

- L1 用 Vitest 运行 11 个编辑器、搜索、目录与样式测试文件。运行 ESLint、Prettier、`pnpm typecheck` 和 `git diff --check`。
- L2 用 Electron `capturePage()` 采集前后截图，测量两排位置、标题间距与底栏。切换关联文件，打开查找，横向滚动并核对折叠按钮位置。

## 结果

- 98 项测试通过。类型、格式、ESLint 和差异检查通过。
- 五类作品的 32 组布局测量通过。普通文稿标题上方的间距从 26–36 px 收紧到 14 px，工具按钮保持单行。五类作品均能切换文件、打开查找并滚动工具栏。长篇在窄栏的文件标签也可独立滚动。
- 长篇故事情节页的折叠按钮与文件标签同排。伏笔触点标题在 620 px 栏宽下上移 4 px。
- 截图左为改前，右为改后。[浅色常规](2026-11-18-editor-hierarchy/compare-light-1200x850-14.png) · [深色常规](2026-11-18-editor-hierarchy/compare-dark-1200x850-14.png) · [浅色窄窗](2026-11-18-editor-hierarchy/compare-light-1000x680-24.png) · [深色窄窗](2026-11-18-editor-hierarchy/compare-dark-1000x680-24.png) · [长篇剧情与伏笔](2026-11-18-editor-hierarchy/compare-light-1000x680-24-long-plot.png)。
- 布局采样。[改前](2026-11-18-editor-hierarchy/before.json) · [改后](2026-11-18-editor-hierarchy/after.json)。

## 未覆盖与后续

- 280 px 栏宽、UI 24 px 下，部分长标题超出单行时会截断，前后截图均可复现。
- 这次使用合成数据验证代表性阶段，未逐个打开所有阶段、真实作品和 Windows 安装包。
