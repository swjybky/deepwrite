# 2026-11-14 开发文档体系重构

返回 [TEST.md](../TEST.md)。

## 目标与成功标准

- AGENTS.md 作为入口，按“需求 → 实现 → 验证 → 出错 → 提交”指向 DESIGN / TEST / ERROR，三者各配目录，渐进加载。
- 原“代码质量与验证”“桌面启动”“易重犯的问题”的约束没有丢失，只是换了位置。
- 所有相对链接可达；`error/` 每个条目都登记在 ERROR.md，且不超过 25 行。
- `test/` 下的产物不影响 `pnpm format:check`、`lint`、`test`。

## 环境

macOS，本地工作区（混有其他会话的未提交改动，本次只碰文档与两处忽略配置）。

## 步骤与命令

1. 用 Python 脚本检查 AGENTS / TEST / ERROR / DESIGN / design / error 与改动过的 docs 文件中的相对链接，以及 error 条目的登记与行数。
2. `pnpm exec prettier --check eslint.config.js test/`；`pnpm exec eslint eslint.config.js --max-warnings=0`。
3. 逐条比对旧 AGENTS.md 删掉的内容，确认在新位置都有。

## 结果

- 通过：链接全部可达（写本报告前唯一的断链就是本报告本身）；13 个 error 条目全部登记，都不超过 25 行。
- 通过：prettier 与 eslint 检查。
- 通过：旧内容的去向——验证要求 → TEST.md；沙盒 → AGENTS“代码质量”+ error/electron-sandbox；四条易重犯问题 → error/ 对应条目。
- 体积：AGENTS 7.7 KB（原 8.4 KB），TEST 3.6 KB，ERROR 2.5 KB，error/ 合计 10.4 KB（只在命中时加载）。

## 第二轮（同日）

- 改动：TEST.md 改为 L1 / L2 / L3 分级，默认不跑全量，并加入样式改动必做的视觉验证（测试环境截图、前后比对、截图发到对话）；ERROR.md 增加“按改动区域预读”；AGENTS.md 流程表改为阶段介绍，简单改动由智能体自行判断。
- L1：链接检查通过；实测 `pnpm vitest related --run tools/electron-launch-environment.mjs` 只跑 3 个相关测试文件，约 15 秒。
- 补充：TEST.md 写明开发环境已配置的模型可直接用于真实模型验证，不必顾虑 token 用量。
- 补充：AGENTS.md 去掉按文件类型的行数上限（约 600 行仅作提醒），新增少写注释的约束。
- 补充：精简 AGENTS.md：压缩协议边界、合并项目布局表；逐项核对，关键约束都还在。

## 未覆盖与后续

- 未跑全量 `pnpm verify`：本次没有改代码，工作区里其他会话的改动也会干扰结果。
- `docs/performance/` 已移到 `test/`；以后新的验证产物都放在 `test/`。
