# 长篇章卡移入正文页签

## 目标与成功标准

- 剧情设计保留全书故事线、剧情点和伏笔总览。正文章节依次显示章卡、正文、章末状态、下一章接续包，点击目录默认显示正文。
- 改前创建的样书直接读取原有 `card.md`。旧章卡选区、提案定位和智能体活动跳转指向对应正文章节的章卡页签。
- 加载完成的章卡按剧情阶段发送。其余三个页签按正文阶段发送。切换期间的发送预检不得使用旧文件上下文。

## 环境

- macOS、Electron、改前建立的隔离开发配置与合成样书。改前使用运行中的项目 Vite 和隔离窗口，改后在同一配置上复核开发版及独立目录中的生产构建。

## 实现范围

- `types/longWorkspace.ts`、`utils/longWorkspaceResourceTree.ts`、`utils/approvalNavigation.ts` 将旧路径和提案定位统一到正文章节。
- `LongWorkspaceEditor.vue`、`useLongEditorStructureSelection.ts`、`useLongEditorDocumentSession.ts` 复用编辑器和保存流程，保留刷新前的活动页签。
- `useLongWorkspacePresentationCoordinator.ts` 保留 `activeLongRoot` 供目录协调与章节写作者资格使用。智能体档案、发送运行上下文、发送一致性检查和活动记录使用 `activeLongAgentRoot`。
- `useLongConversationCoordinator.ts`、`longPlotAgentContext.ts` 从当前文件和索引生成章卡聚焦。活动定位与结构事务使用正文章节节点，新建小节后直接打开章卡。

## 步骤与命令

- L1 `pnpm exec vitest run LongWorkspace. LongWorkspaceEditor.view-mode longWorkspaceResourceTree longWorkspaceNavigation.performance longWorkspace.test.ts longContinuitySelection approvalNavigation agentActivityDescriptors useAgentActivityCoordinator useCurrentAgentActivityView longPlotAgentContext useWorkspaceResourceTreeCoordinator useLongConversationCoordinator useLongWorkspacePresentationCoordinator useLongWorkspaceSessionCoordinator useLongStructureTransactionsCoordinator useLazyLongStructureTransactionsCoordinator useLongEntryReorder useLongEditorDocumentSession useLongEditorDeleteDialogs longTreeItemBoundaries useWorkspaceDialogModuleCoordinator WorkspaceDialogLayer App.performance useLongChapterPlotBinding useLongConflictResolution useLongWorkspaceProposals.version-origin`。
- L1 对改动文件运行 `pnpm exec eslint`、`pnpm exec prettier --check`，并运行 `git diff --check`。
- L2 `pnpm typecheck`、`pnpm lint:boundary`、`pnpm lint:i18n`；向独立输出目录运行 `pnpm --filter @deepwrite/desktop exec electron-vite build --outDir <输出目录>`，用仓库的 `check-renderer-build.mjs` 检查该产物。
- 桌面从剧情设计和正文目录进入，读旧章卡；编辑并自动保存，重开核对磁盘章卡与正文；从正文分卷新建小节、上移并删除测试小节；提交合成连续性记录，保存剧情点绑定并验证 Core 拒绝旧版本写入。

## 结果

- 34 个测试文件、251 项通过，包含保存结构后保留活动章卡的回归。类型、编码风格、Renderer 边界和多语言检查通过。
- 全量类型检查首轮报告 `App.workspace-lifecycle.test.ts(64,52): error TS2769: No overload matches this call.`。共享测试修正后，原命令复跑通过。
- 构建预算通过。应用 JS 1,228,542 B，语言资源 831,818 B，工作台壳 2,762 行。
- 目录与页签 [改前剧情设计](2026-11-20-chapter-card-tabs/01-before-plot.png)、[改前正文](2026-11-20-chapter-card-tabs/02-before-body.png)、[改后正文](2026-11-20-chapter-card-tabs/03-after-body.png)、[改后章卡](2026-11-20-chapter-card-tabs/04-after-card.png)、[保存后重开](2026-11-20-chapter-card-tabs/05-after-card-reopened.png)。
- 章节操作 [新增表单](2026-11-20-chapter-card-tabs/06-new-section-dialog.png)、[新增后默认章卡](2026-11-20-chapter-card-tabs/07-new-section-card.png)、[上移结果](2026-11-20-chapter-card-tabs/08-section-reordered.png)、[删除结果](2026-11-20-chapter-card-tabs/09-section-deleted.png)。
- [已提交章卡](2026-11-20-chapter-card-tabs/10-committed-card.png)、[剧情点绑定](2026-11-20-chapter-card-tabs/11-plot-binding-dialog.png)、[绑定后保留章卡](2026-11-20-chapter-card-tabs/12-plot-binding-saved.png)。Core 拒绝旧时间戳写入，保留最新章卡。
- 发送预检与运行上下文测试覆盖章卡剧情阶段、正文阶段、切换时取消旧预检、提案文件定位和运行中活动位置固定。桌面点击章卡时沿用旧 Markdown 编辑器的保存路径。

## 未覆盖与后续

- 真实模型发送、从真实模型提案卡片发起定位待实测。
