# 阶段状态

## Slice 1：桌面骨架与三栏工作台

状态：已完成（2026-07-17）

范围：

- Electron + Vue + TypeScript + pnpm workspace
- Main / Preload / Renderer / Core Utility / Agent Utility / Tool Utility
- 安全 BrowserWindow 与语义化 Preload API
- 版本化 `system.health` / `system.ready`
- Utility ready / heartbeat / health / shutdown
- Codex 风格三栏与左右折叠
- 左侧五个固定入口及创作空间、技能库、素材库三棵树
- 中间智能体对话视觉壳和可用输入交互
- 右侧文本编辑、预览、只读与演示草稿状态
- Renderer 边界检查、契约测试、构建和桌面冒烟脚本

不在本切片：

- Pi Agent 与 Faux / 真实模型
- 模型 CRUD 和安全密钥存储
- 旧 Write Claw 数据读取、写入或迁移
- 会话持久化、Thinking、Working
- 文件、Shell、HTTP、浏览器等有副作用工具

验收结果：`typecheck`、Renderer 边界检查、5 个单元/契约测试、生产构建、Renderer 构建冒烟、真实 Electron 冒烟均通过；1440×900 与 1120×720 浏览器交互验收通过。

## Slice 2：Pi/Faux 流式对话与实时文稿快照

状态：已完成（2026-07-17）

范围：

- 版本化 `session.prompt`、快速受理结果、Agent Thinking / 文本 / 完成 / 错误事件
- Main / Supervisor / Agent Utility 的命令转发、事件桥接与身份闭环校验
- `@earendil-works/pi-agent-core` / `pi-ai` 0.80.3 Adapter
- 无需 API Key 的本地 Faux Runtime，以及 `thinking=off` 语义
- 超时、主动 abort、Utility 退出合成错误与唯一终态保护
- 同会话单运行、全局并发上限和 Utility shutdown 收敛
- Renderer 内存会话、事件先于 accepted、去重、迟到事件丢弃与竞态隔离
- 发送瞬间的实时主文稿快照；20,000 字符上限带显式截断元数据
- 每资源内存草稿，收起 / 展开 / 切换后不丢失
- 主创作文稿与技能 / 素材“仅浏览、未附加”语义分离
- Renderer CSP、安全进程边界和双向 Zod 校验

本切片明确不包含：

- 真实模型 Provider、模型配置 CRUD 与密钥存储
- Core 数据持久化、旧 Write Claw 数据迁移与文稿落盘
- Agent 对右侧文稿的写回、diff、接受 / 拒绝流程
- 技能 / 素材显式附加交互与工具调用
- 会话历史持久化、恢复、steer、abort UI 和多轮工具编排

验收结果：

- `pnpm verify` 通过：类型检查、Renderer 边界检查、25 项测试与生产构建全部成功。
- `pnpm smoke:renderer` 通过。
- `pnpm smoke` 通过：三个 Utility 健康，Pi/Faux Thinking 与多段文本流以唯一 completed 终态结束。
- 真实 Electron + agent-browser 验证通过：发送、Thinking / 回复完成态、新建会话、未应用草稿恢复与发送快照、技能仅浏览未附加均符合预期。
