# 书籍菜单与绑定弹窗验证

## 目标与成功标准

五类作品共用七项菜单，长篇和剧本杀的置顶能恢复，绑定在三个标签间保留草稿，部分保存失败后可重试。原重命名和长篇维护动作可从管理打开。

## 环境

macOS Electron 探针，合成作品及库与团队数据，1000×680 内容区，浅色和深色，UI 字号 10、14、24px。首次改前抓取后发现主题和侧栏容器配置缺失，存档使用旧团队组件及首次捕获的菜单结构，在相同探针配置下补拍。

## 步骤与命令

- L1 `pnpm exec vitest run TreeNodeItem BookBindingsDialog pinnedResources useLongBookLifecycleCoordinator useLazyLongBookLifecycleCoordinator useShortBookLifecycleCoordinator useLazyShortBookLifecycleCoordinator useWorkspaceDialogModuleCoordinator WorkspaceDialogLayer LongWorkspace.rollback-bindings-and-structure App.performance useMysteryShellBridge useMysteryDocument useWorkspaceResourceTreeCoordinator`
- L1 针对改动文件运行 `pnpm exec eslint --max-warnings=0`、`pnpm exec prettier --check`，以及 `pnpm lint:i18n` 和 `pnpm lint:boundary`。
- L2 `pnpm typecheck`、`pnpm build`、`pnpm smoke:renderer`。
- 附加运行 `node tools/check-source-line-budget.mjs`，检查全仓历史源码行数预算。

## 结果

- 15 个测试文件、82 项通过。涵盖中英菜单、不可用只留移除、置顶恢复、跨标签保留选择、无改动禁用保存和部分失败重试。
- Typecheck、定向 lint、格式、生产构建和 Renderer 预算通过。WorkspaceShell 为 2,755 行，上限为 2,800。
- 改前与改后应用 JS 分别为 1,233,652 B 和 1,230,028 B（上限 1,235,000 B）。语言数据分别为 843,798 B 和 838,136 B（上限 845,000 B）。国际化运行时均为 47,826 B。
- 额外的全仓源码行数命令退出 1。现有超限涉及 `main/index.ts`、`LongForeshadowingWorkspace.vue`、`apply-review.ts`、`useProposalCoordinator.ts`、`styles.css`、`folder-catalog-store.ts` 和 `contracts/src/catalog.ts`，这些文件未因本任务改动。
- Electron 核对了五类菜单、五类名称行、长篇维护区、三个绑定标签、未保存点、键盘切换和 Esc 放弃确认。标签面板为 420px，切换后弹窗外框高度一致。分批加载目录后恢复剧本杀和长篇的置顶顺序，取消置顶写回存储。
- 截图见 [菜单对比](2026-11-18-book-menu-bindings/compare-menus.png)、[团队对比](2026-11-18-book-menu-bindings/compare-team.png)、[绑定状态](2026-11-18-book-menu-bindings/after-binding-tabs.png)、[管理名称行](2026-11-18-book-menu-bindings/after-management-names.png) 和 [长篇维护操作](2026-11-18-book-menu-bindings/after-light-1000x680-longmanage.png)。[文件清单](2026-11-18-book-menu-bindings/changed-files.md)。

```text
apps/desktop/src/main/index.ts has 3101 lines (budget 2000)
apps/desktop/src/renderer/src/components/LongForeshadowingWorkspace.vue has 2849 lines (budget 2000)
apps/desktop/src/renderer/src/composables/proposal-coordinator/apply-review.ts has 1604 lines (new non-test source budget 1500)
apps/desktop/src/renderer/src/composables/useProposalCoordinator.ts has 5368 lines (budget 2000)
apps/desktop/src/renderer/src/styles.css has 4575 lines (budget 2000)
apps/desktop/src/utilities/folder-catalog-store.ts has 8336 lines (budget 2000)
packages/contracts/src/catalog.ts has 3233 lines (budget 2000)
```

## 未覆盖与后续

Windows 安装包、真实作品 IPC 写入，以及实际运行导出、删除、同步旧版本和冲突修复未覆盖。不可用作品按规格仅显示移除，冲突修复通过可打开的长篇管理提供。
