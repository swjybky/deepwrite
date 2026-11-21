# 开发版工作台启动与热更新

## 目标与成功标准

- 冷启动后目录可用。脚本热更新重建工作台后，目录保留，短篇及长篇正文可以从侧栏重新打开。旧工作台的清理和在途请求不能破坏新工作台。

## 环境

- macOS、Electron 42.5.0。用当前源码的临时副本运行 `pnpm dev`，使用独立数据目录和合成样书。

## 步骤与命令（L1 / L2）

- L1 `pnpm exec vitest run` 跑 `App.workspace-lifecycle`、`App.performance`、`catalogIndexStore`、`longWorkspaceStore`、`layoutStore`、`conversationStore`、`useWorkspaceLifecycleCoordinator` 和 `useLongWorkspaceSessionCoordinator`。改动源码通过 ESLint 和 Prettier 检查。
- L2 冷启动并从侧栏打开样书。在临时副本保存 `WorkspaceShell.vue` 的脚本改动，确认同一个页面的组件重建。切回窗口，再从侧栏打开文稿。
- L2 `pnpm --filter @deepwrite/desktop exec electron-vite build --outDir <独立目录>`，用 `check-renderer-build.mjs` 验证产物，并运行 `pnpm smoke:shutdown`。

## 结果

- 73 项定向测试通过，覆盖旧组件卸载、启动阶段的焦点刷新、目录在途读取和长篇在途导航。Renderer 类型和边界检查通过。
- 当前仓库构建预算通过，应用启动 JavaScript 为 1,228,542 B。就绪后退出和启动中退出的冒烟均验证了最终写入落盘，且没有 Utility 重启或孤儿进程。
- [01 热更新前打开样书](2026-11-20-workspace-dev-readiness/01-热更新前打开样书.png)　基线窗口可以打开剧情设计。
- [02 修复前热更新失败](2026-11-20-workspace-dev-readiness/02-修复前热更新失败.png)　旧组件清理后目录消失，焦点刷新复现 `Catalog index store has been disposed.`。
- [03 修复后热更新目录可用](2026-11-20-workspace-dev-readiness/03-修复后热更新目录可用.png)　新工作台保留样书目录和布局元素。
- [04 连续热更新后重新打开正文](2026-11-20-workspace-dev-readiness/04-连续热更新后重新打开正文.png)　三轮真实热更新后均可从侧栏打开同一份文稿。
- [05 热更新后重新打开长篇章节](2026-11-20-workspace-dev-readiness/05-热更新后重新打开长篇章节.png)　长篇样书在冷启动后出现，热更新后第一章可打开。

## 未覆盖与后续

- 未运行 Windows 实机、真实模型或全量测试。已失效的旧窗口需重启一次，后续用修复后的开发窗口继续热更新。
