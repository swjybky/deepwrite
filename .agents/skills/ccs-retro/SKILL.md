---
name: ccs-retro
description: 诊断 DeepWrite 剧本或工作流执行失败时使用：从一次具体失败还原执行过程、按仓库实际分层定位失效层、将修复落到最有效的工具/规则/文档/剧本/入口（或判定偶发），并按层级完成验证。
---

# 剧本失败诊断（ccs-retro）

## 触发条件

满足任一条件时使用本技能：

- 智能体未按 [ccs-mode](../ccs-mode/SKILL.md) 或对应剧本执行，中途漏步、选错入口或绕过检查。
- 智能体按剧本走完流程、甚至测试或检查通过，但结果仍出错、未真正落盘或漏检真实缺陷。
- 验证 CLI（`pnpm -s ctl`）、自定义探测脚本、仓库规则或 CI（`.github/workflows/verify.yml`）放过了本应拦下的问题，或产生误报。
- [ccs-distill](../ccs-distill/SKILL.md) 在梳理历史记录时发现反复踩坑或多次返工的失败模式，转交本技能做根因诊断。

边界：

- 排查或修复产品自身功能缺陷，仍走 `ccs-mode` 的 [fix-bug.md](../ccs-mode/playbooks/fix-bug.md)。
- 沉淀做得好的合作或新增通用做法（非失败诊断），走 [ccs-distill](../ccs-distill/SKILL.md)。

## 输入

开始诊断前先收集以下信息，缺原始记录时直接写明「证据不足及缺失项」，不得凭印象补全过程：

1. **失败表现与预期结果**：实际发生了什么、期望结果是什么、原任务涉及哪个剧本或技能。
2. **至少一项原始证据**：
   - 对话记录或交接笔记（`notes/handoff/<任务名>.md`）；
   - 验证产物目录（`test/<日期-主题>/` 下的 `README.md`、`summary.json`、`REPORT.md`、截图、探针脚本）；
   - 验证 CLI 或检查命令输出（`pnpm -s ctl agent trace`、`ctl logs errors`、`ctl check changed` / `check all`、`ctl check rules` / `check features`）；
   - Git 历史或 CI 日志（`git log`、`git diff`、`gh run view --log-failed`）。

## 步骤与完成标准

1. **还原执行经过，定位证据断点**
   - 核对触发入口：当时是否经过 [ccs-mode](../ccs-mode/SKILL.md) 分派、实际读了哪几个技能/剧本、`references/features/` 功能页、`DESIGN.md` / `design/*.md` 或 `AGENTS.md`。
   - 按时间顺序还原执行过程：跑到哪一步停下或走偏、实际调过哪些工具和命令、该有的验收证据在哪一步断开或失真（例如：工具回执成功但后续读取为空、探针断言写死旧文案、检查仅覆盖局部路径）。
   - **完成标准**：写出可核对的事实时间线与准确断点，每条回指具体文件、行号、`runId`、命令输出或截图；区分已观察事实与合理推测。

2. **按 DeepWrite 实际分层判定失效层**
   - 对照下表定位根因所在层级（一次失败可能同时暴露主因与次因，但每条结论必须有文件、操作或日志依据）：

   | 失效层 | 典型表现 | DeepWrite 对应位置 |
   | --- | --- | --- |
   | **工具层** | 验证脚本误判状态、时序竞态、`ctl` 定位器或参数失配、未回读核验落盘 | `tools/control/`（`lib/`、`commands/`、`scenarios/`）、`tools/check-*.mjs`、`apps/desktop/scripts/`、自定义探测脚本 |
   | **规则与门禁层** | lint/类型/边界/仓库规则/CI 漏拦可机械识别的错误，或未在 `rules/README.md` 闭环 | `eslint.config.js`、`tools/eslint-rules.mjs`、`tools/control/lib/repo-rules.mjs`、`tools/check-renderer-boundary.mjs`、`tools/check-i18n.mjs`、`tsconfig*.json`、`.githooks/`、`.github/workflows/verify.yml` |
   | **文档与功能入口层** | 功能路径、组件或命令已变而功能地图未更新、设计或文案规范缺位 | `references/features/*.md`、`DESIGN.md` 与 `design/*.md`、`AGENTS.md`、`rules/README.md` |
   | **剧本步骤层** | 剧本某一步指令含糊、缺完成标准、未指定具体 `ctl` 命令或易漏核查项 | `.agents/skills/ccs-mode/playbooks/*.md` 及 `.agents/skills/*/SKILL.md` |
   | **任务分派与技能发现层** | 选错剧本、技能 `description` 触发边界不清、分派表缺失或新技能未入发现目录 | `.agents/skills/ccs-mode/SKILL.md` 分派表、各技能 frontmatter、`.claude/skills` 符号链接 |
   | **交接与上下文层** | 跨对话丢上下文、未先读 `handoff`、被脏工作区他会话改动干扰、未用 `--env` 隔离测试实例 | `notes/handoff/<任务名>.md`、`git status` / `git diff`、`pnpm -s ctl env` |
   | **需求理解层** | 动手前未按 `ccs-mode` 复述并等确认、外部协议或前置假设未核实导致做偏 | `ccs-mode` 第 3 步复述记录、原始需求与 `AGENTS.md` 边界 |
   | **偶发，无需调整流程** | 模型单次漏守明确要求、瞬时网络或外部波动，且现有门禁已准确拦下、重跑即过 | 对比失败记录与重跑/门禁拦截记录（严禁为偶发事件给剧本强行加条款） |

   - **完成标准**：给出明确的失效层与根因判断（或明确判定为「偶发，无需调整流程」），每项结论均附对应文件/日志依据。

3. **确定修复落点并防复发**
   - 与 [ccs-distill](../ccs-distill/SKILL.md) 共用同一落点优先级，能下沉到自动机制就绝不只靠文字约束：
     1. **修工具**：能变成可靠命令、时序收敛或落盘校验的，修 `tools/control/` 或对应脚本；
     2. **加规则**：能机械判定的错误模式，加进 `tools/eslint-rules.mjs`、`tools/control/lib/repo-rules.mjs` 或 `tools/check-*.mjs`，并同步登记 `rules/README.md`；
     3. **补文档 / 规范**：入口映射、设计约束或验收口径缺口，补进 `references/features/*.md`、`DESIGN.md` / `design/*.md` 或 `AGENTS.md`；
     4. **改剧本或分派入口**：确需智能体主观判断的步骤，才改 `.agents/skills/ccs-mode/playbooks/*.md`、相关 `SKILL.md` 或 `ccs-mode` 分派表（按 `ccs-mode`「B. 提炼剧本」写法写清具体动作、工具和完成标准）；
     5. **不改流程**：若第 2 步判定为偶发且现有门禁有效，保持流程精简不加补丁。
   - 边界：纯诊断请求不直接改仓库文件；涉及改动工具、规则或跨多处调整时，先列拟改文件与前后差异，等用户确认后再落盘。
   - **完成标准**：给出明确的修复位置、修改前后差异、选层依据与防复发机制（或说明为何保持现状）。

4. **按修复层分级验证**
   - **修工具**：补**成功 + 失败/异常**双向单元测试（如 `tools/control/*.test.mjs`），跑定向 `pnpm exec vitest run <测试文件>`，按 [verify](../verify/SKILL.md) 跑 `ctl check changed`（改 `tools/` 检查脚本时按 `verify` 规则跑 `ctl check all`），并在隔离测试实例 `--env <名>` 实测复跑原失败场景。
   - **改规则**：在 `tools/control/repo-rules.test.mjs`（或对应规则测试）补**应通过 + 应拒绝**双向用例，跑 `pnpm -s ctl check rules [规则名]`、确认已更新 `rules/README.md`，并按 [verify](../verify/SKILL.md) 跑统一检查。
   - **改文档 / 功能地图**：跑 `pnpm -s ctl check features` 与 `pnpm -s ctl check changed --files <改动文件>`。
   - **改剧本 / 分派入口**：跑 `pnpm -s ctl check changed --files <改动文件>`，并按 [ccs-mode](../ccs-mode/SKILL.md)「C. 检验剧本」用**全新会话**重跑原失败任务或同类小任务，验证能否准确选中并走通（当前会话无法替用户开新主对话时，交付可直接执行的回归提示词并明确标为「仍待验证」）。
   - **偶发无需调整**：附上重跑通过或现有断言已成功拦截的原始证据。
   - **完成标准**：已完成与修复层级匹配的验证并保留真实输出；任何未执行的验证项均明确列为「仍待验证」。

## 输出清单

1. **执行还原与证据断点**：读了什么、跑到哪步、在哪一步断了（附路径、`runId`、命令或日志）。
2. **失效层与根因**：所属分层、回指证据、排除其他层的理由（或判定「偶发，无需调整流程」）。
3. **修复落点与前后差异**：最能生效的修改位置、改动前后对比、防止复发的方式。
4. **验证证据与待验项**：已跑过的双向单测/规则检查/隔离实测结果；仍待全新会话或真机验证的项目。
