---
name: 严重bug修改
description: 深入定位并直接修复 DeepWrite 本地写作桌面客户端仓库中的严重 bug、阻断性缺陷、高风险问题或跨 Renderer 与 Preload / Main / Core / Agent / Tool Utility / contracts 链路异常；适用于用户明确要求修严重 bug、困难 bug、联调阻断问题、流式会话 / 写回 diff / Catalog 存储 / 智能体工具链异常，并要求最终生成 `docs/bug解决需求文档/需求文档/敏捷需求与bug/{批次号}-解决结果.md` 的场景。
---

# 严重 Bug 修改

在当前 DeepWrite 仓库中处理严重 bug 时，必须先沿真实页面、协议、流式事件、本地写入和智能体工具调用链定位根因，再直接修改代码解决问题，最后生成解决结果文档。

## 工作边界

- 覆盖 Renderer、Preload、Main、Core / Agent / Tool Utility、`packages/contracts`、Pi Runtime Adapter、本地 Catalog 存储、模型配置和跨层联动问题。
- 不只处理表象；必须追到数据来源、协议参数、响应映射、流式事件、渲染状态、revision 校验和 Utility 服务逻辑。
- 不处理当前仓库之外的移动端、其他后端服务或无关业务系统路径；这些不是当前项目结构。
- 不做无关重构，不回滚用户已有改动，不扩大修改范围。
- 涉及真实用户数据目录、密钥或外部系统配置时，只生成可执行说明写入结果文档，不直接执行生产数据变更。

## 必做流程

### 1. 明确故障面

- 提取用户描述中的页面、模块、按钮、协议命令、流式事件、智能体、工具、错误信息、截图路径、复现步骤和期望结果。
- 如果用户提供截图或日志路径，先读取对应文件；读取失败时在最终结果中说明。
- 根据影响判断涉及 Renderer、Main / Utility、contracts 或跨层链路，不要只按用户最初定位限制排查范围。

### 2. 结合当前项目定位代码

优先按以下顺序搜索和阅读：

- Renderer：`apps/desktop/src/renderer/src/components/`、`composables/`、`data/`、`utils/`、`types/`、`ui-feedback.ts`、`App.vue`。
- Preload / Main：`apps/desktop/src/preload/`、`apps/desktop/src/main/`（含 supervisor、model-config、workspace-directory）。
- Utilities：`apps/desktop/src/utilities/`（`core-entry`、`agent-entry`、`tool-entry`、catalog / folder store、legacy 导入）。
- 契约与运行时：`packages/contracts/src/`、`packages/shared/`、`packages/pi-runtime-adapter/`。
- 配置与规范：根目录 `AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/PHASE_STATUS.md`。
- 文档：`docs/bug解决需求文档/`，仅在需要确认历史方案或契约时读取。

定位时同时检查同模块已有实现，复用现有模式和命名，不新造平行协议或重复组件。

### 3. 深入分析根因

修复前必须形成明确判断，至少覆盖：

- 触发条件：什么输入、状态、数据量、路由、流式事件、配置或操作顺序会触发。
- 真实根因：前端状态、协议参数、字段映射、Core 写入、Agent 事件、工具调用、revision / 冲突或配置中的哪一环出错。
- 影响范围：同一页面、会话隔离、Catalog 项目类型、写回审阅、模型配置和测试是否受影响。
- 修复策略：为什么选择当前修改点，如何兼容旧数据、旧事件和现有调用方。

如果根因不在用户描述的端侧，也要继续追到真正出错的层并直接修复。

### 4. 直接落地修复

- 按最小稳定修改原则改代码，优先在既有组件、composable、Preload、Main、Utility、契约或配置中补齐逻辑。
- Renderer 遵循 Vue 3、TypeScript、Pinia、Naive UI；禁止导入 Node / Electron / Pi Runtime。
- 临时提示使用浮层反馈；风险操作才用模态确认。
- 协议变更同步 `packages/contracts`、Preload 校验与调用方。
- Core 继续作为项目文件唯一写入者；不得在 Renderer 直接写磁盘。
- 新增配置字段走现有 store / 配置封装，不把密钥写入源码或文档。
- 如需用户执行数据修复或外部配置，只生成文本说明，不直接改生产数据。

### 5. 验证

根据改动范围选择能落地的验证：

- 仓库根：`pnpm typecheck`、`pnpm lint`、`pnpm test`，或针对修改文件的单测。
- 构建：`pnpm build`、`pnpm smoke:renderer`；涉及 Electron / Utility 健康时尽量 `pnpm smoke`。
- 大改动可用 `pnpm verify`。
- 运行级验证：必要时启动 `pnpm dev`，走关键页面、协议或流式会话。
- 如果因为依赖、环境、外部 Provider 无法验证，说明具体阻塞原因，并给出可复验步骤。

## 解决结果文档

修复完成后，必须在以下目录生成一个 Markdown 文档：

`docs/bug解决需求文档/需求文档/敏捷需求与bug/{批次号}-解决结果.md`

批次号规则：

- 用户提供批次号时，使用用户给定批次号。
- 用户未提供时，使用当前时间 `YYYYMMDD-HHMM`。

文档内容必须包含：

```markdown
# {批次号} - 严重 Bug 解决结果

> 生成时间：YYYY-MM-DD HH:mm:ss
> 修复范围：Renderer / Preload / Main / Core / Agent / Tool / contracts / 多层联动
> 修复状态：已修复 / 部分修复 / 未修复

## 问题概述

- 用户描述：
- 影响模块：
- 触发路径：

## 根因分析

- 触发条件：
- 根因定位：
- 影响范围：

## 修复内容

- 修改文件：
- 核心改动：
- 兼容处理：

## 验证结果

- 已执行验证：
- 验证结论：
- 未验证项及原因：

## 本地数据、配置或后续处理

如无则写“无”。如有用户数据或外部系统变更，仅写可执行说明和执行注意事项。
```

## 最终回复

最终回复保持精简，包含：

- 修改文件。
- 根因摘要。
- 修复摘要。
- 结果文档路径。
- 验证结果。
