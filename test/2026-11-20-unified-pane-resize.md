# 工作区统一分栏拖动验证

## 目标
短篇、剧本、学术、长篇和剧本杀共用外栏分隔线。拖动外栏时工作区和长篇编辑器保持零更新，长篇列表每次宽度变化只布局一次，五个采样宽度下的列边界误差不超过 1 px。

## 环境
macOS 26.5.1，Apple M5，Electron 42.5.0，生产构建，临时数据目录。改前为 `accd0006`，改后为本轮 Renderer 修改。主采样窗口 1400×800，合成正文各约 5,000 字，空聊天，展开同一份 200 章目录，章卡每页最多 50 项。

## 步骤与命令
- L1 运行 `pnpm vitest run WorkspacePaneResizer useLongEditorPaneResize layoutStore LongWorkspace.editor-and-layout LongWorkspace.agents-writing-and-navigation App.general-settings App.performance RightEditorPane WorkspaceFeatureModules.behavior LongWorkspaceEditor.view-mode`。
- L1/L2 对本次文件运行 `pnpm exec eslint --max-warnings=0`（TS、Vue）、`pnpm exec prettier --check`、`pnpm lint:i18n`、`pnpm exec vue-tsc --noEmit -p apps/desktop/tsconfig.web.json`、`pnpm build`。
- 桌面探针每次先调用 `assertElectronLaunchAllowed()`，再用 `apps/desktop/node_modules/.bin/electron /private/tmp/deepwrite-unified-probe` 启动隔离探针，改后加 `UNIFIED_PHASE=after`。用资源树打开正文，从真实外栏分隔线发出可信输入，350–690 px 往返 2.2 秒，间隔目标 4 ms。每页每档 CPU 各采 3 次。另采 1 次 Vue 渲染计数。脚本用完删除。
- 取 CDP `TaskDuration` 差值除以真实宽度更新数，各档取三次中位数。慢帧为 4 倍限速下三个样本合计的 `requestAnimationFrame` 间隔 >25 ms 的比例。另用 PIL 对照 20 对 PNG。[改前原始采样](2026-11-20-unified-pane-resize/before.json) · [改后原始采样](2026-11-20-unified-pane-resize/after.json)

## 结果

| 页面 | 主线程 ms／次（原速） | 主线程 ms／次（4 倍） | 慢帧（4 倍） | 布局／次（原速） | 工作区渲染 | 长篇编辑器／正文渲染 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 短篇正文 | 4.33 → 3.47 | 5.68 → 5.57 | 0/393 → 0/393 | 1.00 → 1.00 | 132 → 0 | — |
| 长篇普通章节 | 3.61 → 3.16 | 7.33 → 6.20 | 0/393 → 0/393 | 1.00 → 1.00 | 132 → 0 | 132/132 → 0/0 |
| 长篇章卡右列表 | 5.06 → 4.33 | 15.48 → 11.37 | 5/387（1.29%）→ 2/391（0.51%） | 1.72 → 1.00 | 132 → 0 | 243/— → 0/— |
| 剧本杀正文 | 3.30 → 3.02 | 6.46 → 5.44 | 0/393 → 1/393（0.25%） | 1.00 → 1.00 | 132 → 0 | — |

- 四页的有效拖动样本均为 0 条工作区 IPC。普通章节与章卡页每次更新的样式重算中位数为 3.07 → 3.08、5.25 → 3.08。原容器查询保留。
- 外栏宽度 350、380、460、520、690 px，章卡与剧情线两套列表、正文、把手及编辑器边界完全一致。剧情线键盘操作更新可访问值并保存偏好。普通章节同一编辑元素折叠期间常驻，展开后保留未保存文字和光标。对调分栏后，折叠聊天保留中栏编辑器。[剧情线改前](2026-11-20-unified-pane-resize/before-extra.json) · [剧情线及交互改后](2026-11-20-unified-pane-resize/after-extra.json)
- 20 对截图覆盖两种主题、380/690 px 外栏及 1000×680／24 px 字号。19 对像素相同，最小窗口的剧本杀有 1 个标题栏像素差异。每对原图和差异坐标见[截图索引](2026-11-20-unified-pane-resize/screenshot-comparison.json)。
- 验证命令和重跑结果见[命令记录](2026-11-20-unified-pane-resize/validation.txt)。

## 未覆盖
Windows 实机、真实作品、长文叠加长聊天、流式会话、高刷新率及读屏实机。剧本与学术沿写作模块共用分隔线，四页性能采样未单独打开这两类作品。
