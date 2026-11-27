---
name: verify
description: 任何代码、配置或文档改动在报告完成或提交之前都要用。跑仓库统一检查（pnpm -s ctl check changed / check all），全部通过才算完成；说明何时必须跑全量、失败怎么处理、提交钩子的规则。
---

# 验证改动

**规则：任何改动在报告完成、提交之前，都必须跑统一检查并全部通过（输出 `"ok": true`）。** 没跑或没全过，不能说“已完成”。

## 跑哪个

| 命令 | 范围 | 耗时 | 什么时候用 |
| --- | --- | --- | --- |
| `pnpm -s ctl check changed --files <本次改动文件>` | 只检查本次改动文件的格式、lint、对应类型、边界、文案、功能地图、规则与受影响测试 | 几秒到一分钟 | **工作区混有其他任务未提交改动时（默认）** |
| `pnpm -s ctl check changed` | 检查相对 `HEAD` 的全部未提交改动与受影响测试 | 几秒到一两分钟 | 工作区只有本次改动（干净）时 |
| `pnpm -s ctl check all` | 全仓格式、lint、5 个 tsconfig 类型检查、边界、文案、功能地图、仓库规则与全部测试，按 frontend / backend / tooling 汇总 | 约 7 分钟 | 见下 |

- 跑 `check changed` 前先对本次改动文件运行 `pnpm exec prettier --write <本次改动文件>`，避免格式问题触发整轮重跑。
- `check changed` 在前置静态检查（`prettier` / `eslint` / `typecheck` 等）失败时会自动跳过 `tests`；修完前置问题后再重跑同一命令。

以下情况必须跑 `check all`，`check changed` 不够：

- 改了 `packages/contracts/`（两端都依赖它）。
- 改了 `tsconfig*.json`、`eslint.config.js`、`vitest.config.ts`、`prettier.config.mjs`、`.prettierignore`。
- 改了依赖：`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`。
- 改了 `tools/` 下的检查脚本（`check-*.mjs`、`tools/control/lib/check-all.mjs`）。
- 用户要求跑全量，或准备发版。

先 `--dry-run` 可以看会跑哪些步骤。

仓库规则可用 `pnpm -s ctl check rules [规则名]` 单独复查，输出包含问题位置和修复建议。

## 失败了怎么办

1. 按输出里的 `nextSteps` 和 `findings`（文件、行号、规则或错误码）修，修完重跑同一个命令。
2. 只为通过检查而改检查本身是不允许的：不放宽 tsconfig / eslint 规则，不加 `eslint-disable`、`@ts-ignore`、`@ts-expect-error`，不 `--skip` 掉失败的步骤，不改测试去迁就错误行为。确实需要时先问用户。
3. 工作区常混有别的会话的改动，平时优先用 `pnpm -s ctl check changed --files <本次改动文件>`；若未传 `--files` 导致失败出在本次没碰的文件上，先用 `git diff` 确认它和本次改动无关，再补跑 `--files <本次改动文件>` 证明本次改动全过。回复里仍须写明未传 `--files` 的那次哪一步、哪个文件失败及判断无关的依据（记为未通过，不能报成通过）。

## 提交

- `pnpm install` 会把 `core.hooksPath` 设为 `.githooks`。`pre-commit` 钩子会对暂存区跑 `check changed --staged`，不通过就拦下提交。
- 不准用 `git commit --no-verify` 绕过钩子；钩子失败就修。
- 钩子没生效时（`git config core.hooksPath` 不是 `.githooks`），运行 `node tools/install-git-hooks.mjs`。

## 检查通过不等于功能可用

这些检查只管静态正确性和单元测试。界面和智能体的行为要另外在隔离测试实例上实测：按 AGENTS.md「验证」一节，以及 `references/features/` 里对应功能页的「用验证 CLI 驱动」。

## 回复里写什么

- 跑了哪个命令、是否 `ok`、耗时。
- 跳过了什么、为什么跳过。
- 有未通过项时，列出步骤和文件。
