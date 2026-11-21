# 统一导出弹窗

## 目标与成功标准

短篇、剧本、长篇、学术、剧本杀及资料库共用导出弹窗。长篇和学术共用勾选列表。各领域沿用原请求，库菜单先打开确认弹窗。

## 环境

macOS Electron 42.5.0。桌面探针使用当前 Vue 组件、独立用户目录和合成数据。资料库使用真实菜单、弹窗层、协调器和 Main ZIP 导出器，通过探针桥注入系统目录选择结果。资料库改前图记录原流程的菜单入口，创作空间改前图在改代码前采集。

## 步骤与命令

- L1 执行 `pnpm exec vitest run`（20 个相关测试文件）、改动文件 `pnpm exec eslint`、`pnpm exec prettier --check`、`git diff --check`。
- L2 执行 `pnpm typecheck`、`pnpm lint:boundary`、`pnpm lint:i18n`、`pnpm build`、`pnpm smoke --book-images-only`。桌面探针先运行 `assertElectronLaunchAllowed()`，再用 `capturePage()` 采集前后图。

## 结果

- 124 项定向测试通过。类型、边界、语言、格式、构建和书籍图片冒烟通过。预算余量为应用 JS 4,275 B、语言数据 9,278 B、i18n 运行时 12,174 B、合计 25,727 B。工作台 Shell 2,755 / 2,800 行（按测试计数）。
- 7 个入口、8 种状态各覆盖浅色和深色，以 1200×900 / UI 14px 和 1000×680 / UI 24px 逐一对照。32 个状态的底部按钮均可触达，内容区无横向溢出。长篇和学术在最小窗口可滚动；宽度 680px 时标准卡一列、紧凑卡两列。另测英文小窗学术弹窗。[布局采样](2026-11-20-unified-export-dialogs/layout-results.json)
- 短篇和剧本提交 Markdown，长篇验证 TXT 分文件和 Markdown 合并及章节筛选，学术验证 Markdown 单文件、空小节及章标题层级，剧本杀验证 `{ format: "md", playerScriptLayout: "by-role-act" }`。
- 素材库依次验证 [菜单](2026-11-20-unified-export-dialogs/material/01-menu.png) → [确认](2026-11-20-unified-export-dialogs/material/02-confirm.png) → [提交中](2026-11-20-unified-export-dialogs/material/03-pending.png) → [取消系统选择后保留弹窗](2026-11-20-unified-export-dialogs/material/04-cancelled-picker.png) → [重选并导出](2026-11-20-unified-export-dialogs/material/05-success.png) → [归档内的 Markdown](2026-11-20-unified-export-dialogs/material/06-zip-contents.png)。技能分组显示 2 个库，[模拟选择失败](2026-11-20-unified-export-dialogs/skill/01-error-retry.png) 后[重试成功](2026-11-20-unified-export-dialogs/skill/02-success.png)，解包读到两条技能正文。
- 初测 `vue-tsc` 报 `TS2379`（可选 action 的显式 undefined）和 `TS2345`（学术协调器仍使用的文案键）。修正后通过。探针在 Electron 桥捕获 `An object could not be cloned.`，将导出状态改为浅层响应并加结构化克隆回归断言后，取消及成功路径均通过。

| 左改前，右改后 | 浅色常规 | 深色小窗 | 对照结果 |
| --- | --- | --- | --- |
| 短篇 | [对照](2026-11-20-unified-export-dialogs/short/compare-light-1200x900-14.png) | [对照](2026-11-20-unified-export-dialogs/short/compare-dark-1000x680-24.png) | 图片说明入范围框，复制卡通栏 |
| 剧本 | [对照](2026-11-20-unified-export-dialogs/script/compare-light-1200x900-14.png) | [对照](2026-11-20-unified-export-dialogs/script/compare-dark-1000x680-24.png) | 剧集范围与格式卡对齐 |
| 长篇分文件 | [对照](2026-11-20-unified-export-dialogs/long/compare-light-1200x900-14.png) | [对照](2026-11-20-unified-export-dialogs/long/compare-dark-1000x680-24.png) | 文件格式与方式分区，章数随底栏固定 |
| 长篇合并 | [对照](2026-11-20-unified-export-dialogs/long-single/compare-light-1200x900-14.png) | [对照](2026-11-20-unified-export-dialogs/long-single/compare-dark-1000x680-24.png) | 合并选项与文件按钮可见 |
| 学术 | [对照](2026-11-20-unified-export-dialogs/academic/compare-light-1200x900-14.png) | [对照](2026-11-20-unified-export-dialogs/academic/compare-dark-1000x680-24.png) | 格式排在树前，空小节与三态复选清晰 |
| 剧本杀 | [对照](2026-11-20-unified-export-dialogs/mystery/compare-light-1200x900-14.png) | [对照](2026-11-20-unified-export-dialogs/mystery/compare-dark-1000x680-24.png) | 下拉换为常显选项 |
| 素材单库 | [对照](2026-11-20-unified-export-dialogs/material/compare-light-1200x900-14.png) | [对照](2026-11-20-unified-export-dialogs/material/compare-dark-1000x680-24.png) | 菜单后新增 ZIP 确认 |
| 技能分组 | [对照](2026-11-20-unified-export-dialogs/skill/compare-light-1200x900-14.png) | [对照](2026-11-20-unified-export-dialogs/skill/compare-dark-1000x680-24.png) | 范围框显示库数量 |

## 未覆盖与后续

Windows 实机、资料库生产 IPC 和原生文件选择器的视觉未测。资料库桌面流程使用真实 ZIP 写入与替身选择器。其余两档对照图及滚动后的截图同目录归档。
