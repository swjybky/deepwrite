# 长篇剧情设计与章卡审阅去 JSON

## 目标与成功标准

1. 剧情/章卡提案显示具体文件正文红绿差异与中文语义关联变化，不展示原始 JSON；
2. 非破坏性剧情修改支持卡内「修改」与一键「接受并保存」，按目标隔离 `laneId` 且仅建立真实前置创建依赖；
3. 浅色/深色、`1200×900`/`1000×680`（24px）无横向溢出与裁切，回归与构建预算通过。

## 环境

- macOS，工作区 `/Users/wenjia/project/deepwrite`（混有他人在改工作树文件）；Electron 42.5.0（`ELECTRON_OK`）。

## 步骤与命令

- **L1 单元测试与风格**：`pnpm vitest run` 12 个测试文件（115 用例，含 `longProposalChangePresentation.test.ts`、`longMutationProposal.test.ts`、`long-proposal-events.test.ts`、`long-agent-tools.mutations.test.ts`、`agent-entry.test.ts`、`AgentConversation.test.ts`、`LongProposalReview.test.ts`、`AgentEditProposalCard.stale.test.ts`、`useProposalCoordinator.long-recovery.test.ts`、`useAgentConversation.proposal-persistence.test.ts`、`agentProposalEdit.test.ts`、`approvalNavigation.test.ts`）；`pnpm exec eslint --max-warnings=0` 与 `prettier --check` 覆及全部 36 个本次改动/新建文件。
- **L2 类型、边界与构建**：`tsc --noEmit` 检查 `tsconfig.node.json` 及三个子包，`vue-tsc --noEmit -p apps/desktop/tsconfig.web.json`，`pnpm lint:i18n`，`pnpm lint:boundary`，`pnpm build`。
- **L2 视觉验证**：Electron 探针同条件截取 `test/2026-11-17-long-plot-proposal-review/` 下前后各 4 组截图并读图核对。

## 结果

- **通过**：12 个单测文件 `115/115` 全部通过；36 个改动文件 ESLint 与 Prettier 全通过；4 份 tsconfig、`pnpm lint:i18n` 与 `pnpm build` 通过（Renderer app-ready JS `1,206,845 B`，语言包 `843,779 B` 均在预算内）。前后 4 组视觉对比图全部 `scrollWidth === clientWidth`（无溢出），`before` 中的原始 `{ structureOperations, documentWrites }` JSON、`"剧情设计变更"` 与单文件折叠已替换为具体标题、中文「关联与结构变化」、真实红绿正文差异、「修改」与「接受并保存」按钮及 3 个独立文件项。
- **未改动失败归因**：工作区原有未涉本任务修改文件 `ScopedGlobalStyles.test.ts` 引入 `node:fs`，导致全量 `vue-tsc`（仅此 1 行）与 `pnpm lint:boundary` 报错，本次改动文件无违规导入或类型错误。

## 未覆盖与后续

- 真模型端到端长篇多轮工具运行及删除类提案实盘二步确认流未跑真机对话，待实盘联调顺带验证。
