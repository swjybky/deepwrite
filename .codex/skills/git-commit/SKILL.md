---
name: git-commit
description: 在 DeepWrite 创建 Git 提交、推送、Pull Request 或合并时使用，核对变更范围、项目校验、提交身份与署名。
---

# DeepWrite Git 提交与交付

适用于用户明确要求的 Git 交付，以及已授权发布流程中必需的提交；仅编辑代码不自动提交。若发布技能对提交文件或发布顺序有更窄的约束，优先遵循该约束。

## 提交前

1. 检查当前分支、工作树、暂存区、未跟踪文件和相关 worktree；涉及同步或推送时再检查远端与待推送提交。保留已有改动和 stash，只暂存本次任务经审阅的文件，不使用 `git add .`、`git add -A` 或会夹带其他改动的提交方式。
2. 审阅拟提交的 diff，特别检查新增或修改的测试、夹具、快照和日志中是否有真实地址、IP、密钥或凭据。代码提交只对本次暂存的文件跑 TEST.md 的 L1：`pnpm vitest related --run <文件>`、`pnpm exec eslint <文件>`、`pnpm exec prettier --check <文件>`，改了类型或契约再加 `pnpm typecheck`；用户说过已验证、本会话测过且之后未改时不再重复。不跑全量 `pnpm verify`，全量由 CI 在推送后执行，只有用户明确要求才本地跑。失败时只修本次改动导致的问题，未通过时不得宣称验证成功或继续提交。文档或技能改动只检查格式和 diff。
3. 本仓库的 commit 身份固定为 `carswj <wenjia@wenjiadeMacBook-Air.local>`。检查仓库级 Git 配置；缺失或不符时只用 `git config --local user.name carswj` 与 `git config --local user.email wenjia@wenjiadeMacBook-Air.local` 修正，不改全局身份。

## 提交、PR 与合并

- 创建 commit、PR 或合并信息时，不自行添加额外个人作为共同作者、协作者或附加署名，也不添加 `Co-authored-by`、`Signed-off-by` 等尾注；只有用户明确要求某项署名时才添加。使用仓库 Git 身份和 GitHub 自动记录。
- 提交前检查 `git diff --cached --check` 与暂存文件清单；提交后核对提交文件和工作树，确认未夹带无关内容。
- 用户要求推送时，先核对目标分支与远端历史，确保不会把无关的本地提交一起推送；禁止强推或改写他人历史。推送后核对远端 SHA 与本地目标提交。创建 PR 或合并时也先核对目标分支、变更范围与所需校验。
