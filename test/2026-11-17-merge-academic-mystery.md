# 学术写作与剧本杀双工作树合并验证

## 目标与成功标准

- 将 `deepwrite-academic`（`feat/academic-writing`）与 `deepwrite-mystery`（`feat/mystery-workspace`）以基于 `5b2afaea` 的三方合并接入 `main` 工作区，完整保留 `main` 原有 180 处未提交改动与 `stash@{0}`，不在 `main` 创建提交。
- 双特性共享 `contracts`、`pi-runtime-adapter`、`main` 5 团队架构、资料库跨文体池及外部 MCP，并修复 `mixed` 素材库挂载与异步加载占位错配。
- 通过静态边界检查、构建预算门禁、回归单测、5 项定向 Electron 冒烟与 5 类型桌面视觉对比，随后仅在各自子工作树分支备份提交并移除两个子 worktree。

## 环境

- macOS、Node 24.19.0、Electron 42.5.0、独立合成 `userData` 夹具（无真实稿件与外网请求）。

## 步骤与命令（L1 / L2）

- **L1 静态与预算：** `tsc --noEmit`（`tsconfig.node.json` 与 3 子包）、`vue-tsc --noEmit`、`pnpm exec eslint apps packages tools --max-warnings=0`、`pnpm lint:boundary`、`pnpm lint:i18n`、`pnpm build && pnpm smoke:renderer`。
- **L1/L2 单测：** `vitest run packages/contracts packages/pi-runtime-adapter`、28 份 Main/Utilities/ProposalCoordinator 套件、11 份 `external-control` 套件、`App.performance.test.ts`、`WritingWorkspaceModule.test.ts` 及组件测试。
- **L2 Electron 冒烟与视觉：** `electron-smoke.mjs` 四项（`--conversation-only` / `--external-concurrency-only` / `--library-entries-only` / `--library-groups-only`）、`pnpm smoke:shutdown`，及隔离探针在 `1440×900`（浅色 14px）与 `1000×680`（深色 24px）实测建书/侧边栏/团队/智能体设置五入口。

## 结果

- **通过：** Node 与 3 子包类型检查、ESLint（`apps packages tools`）、`lint:i18n`、`WorkspaceShell.vue`（2796 行 <= 2800）、构建预算（strict `178,505 B`，application JS `1,227,381 B < 1,235,000 B`[自 1,200,000 微调]，语言包 `843,779 B < 845,000 B`，i18n `47,826 B < 60,000 B`）；`contracts+pi-runtime-adapter` 251/252 文件（2069/2073）、28 份核心套件（186/186）、`external-control` 11 份（147/147）及改动后 `App.performance` + `WritingWorkspaceModule` 11/11 全过；5 项定向桌面冒烟与视觉探针（0 渲染报错、横向溢出 0px）均通过，见 [视觉指标](2026-11-17-merge-academic-mystery/visual-metrics.json) 与同目录 `after-*.png`。
- **已知非本次问题（未改 `main` 无关文件）：** `ScopedGlobalStyles.test.ts` 引入 `node:fs` 致全量 `vue-tsc`/`lint:boundary` 报该 1 文件；全量 `pnpm lint` 受 `website/` 全局变量配置报错；`connection-test-thinking-options.test.ts` 因 `main` 先行新增 `{ onDeveloperRoleFallback }` 失败 4 项；全量 `pnpm smoke` 麦克风/i18n 旧子项见子报告说明。

## 未覆盖与后续

- 全量 `pnpm test`、真实远程 LLM 生成与 Windows 安装包未跑；移动端 `deepwrite-app` 若同步双作品/资料库 schema 需对照镜像更新。
