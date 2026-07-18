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

## Slice 3：真实模型配置与默认思考等级

状态：已完成（2026-07-17）

范围：

- 参考旧 Write Claw 的多模型字段语义，重构为独立的版本化 Zod 契约
- 模型添加、编辑、删除、默认模型、连接测试和运行时选择
- 每个模型独立配置 `reasoning` 与默认思考等级
- 思考等级统一支持 `off / minimal / low / medium / high / xhigh`
- 新会话继承默认模型的默认思考等级；切换模型时同步该模型默认值
- 对话输入区允许本轮覆盖模型和思考等级
- Main 进程使用 Electron `safeStorage` 加密保存 API Key，Renderer 只读取 `hasApiKey`
- Renderer 公共命令与携带密钥的内部 Agent 命令分离；Main 拒绝 Renderer 直接调用内部命令
- 模型连接测试与正式对话共用同一套配置解析和 Provider Runtime
- 支持 OpenAI Completions、OpenAI Responses、Anthropic Messages 与 Google Generative AI API
- 未配置真实模型时继续使用本地 Faux，不产生隐式网络请求

验收结果：

- `pnpm typecheck`、`pnpm lint`、29 项测试、生产构建和 Renderer 冒烟均通过。
- 沙箱外真实 Electron 冒烟通过：三个 Utility 健康，Faux Thinking / 文本流保持唯一完成终态。
- agent-browser 可见验收通过：添加模型、Provider 预设、默认思考等级、模型卡片及对话区两个选择器均正常，控制台无报错。

本切片仍不包含：

- 会话历史持久化、恢复与跨会话记忆
- 旧 Write Claw 模型配置自动导入
- Core 文稿持久化、Agent 写回、diff 与接受 / 拒绝
- 技能 / 素材显式附加及有副作用工具

## Slice 4：短篇阶段智能体与创作设置

状态：进行中（2026-07-17，第一批已落地）

已落地：

- 按 Write Claw 当前短篇实现同步六个内容槽位与四层可见导航：人物、剧情（剧情设计 / 导语设计 / 剧情细化）、大纲、正文
- 同步五个智能体身份、默认系统提示词和默认读取范围；三个剧情子阶段共用剧情智能体
- 设置页新增“创作 / 创作空间”，可编辑五份系统提示词和工作区、素材、技能读取范围，并支持按智能体恢复默认；分节写手明确标注调度尚未接通
- Main 使用 `userData/config/workspace-agents.json` 原子保存设置；必需阶段读取权限在 Main 再次补齐
- 每轮根据短篇 `activeStageId` 在 Main 选择可信智能体；每部作品的人物、剧情、大纲、正文协调分别保留内存多轮上下文和可见历史
- 普通阶段接通 `read_workspace_content`、`search_workspace_text`、`query_linked_material_entries`、`load_skill`、`switch_storyline_stage`、`write_workspace_editor`、`replace_current_stage_text`
- 正文协调先接通 `initialize_expert_draft` 和 `edit_expert_draft_section` 的扁平 Markdown 版本
- 工具请求、结果、阶段切换和编辑器变更通过版本化事件返回；写工具只修改 Renderer 内存草稿
- 截断阶段禁止整段写入、正文骨架重建和局部替换，避免 20,000 字符安全快照导致正文尾部丢失
- 编辑器在对应智能体运行中暂停手动输入；工具 mutation 以 `baseRevision` 做乐观版本校验，迟到 run 或版本冲突不会覆盖最新草稿
- 作品位置、runId 与附件目录只做本轮动态注入，持久 transcript 会还原为用户原始消息

尚未迁移完成：

- 结构化 `ExpertDraft`、正文小节与人物状态一一对应的数据模型
- `write_single_expert_section`、`start_expert_writing` 后台顺序调度
- 分节写手的正文读取 / 写入 / 替换与人物状态写入 / 替换工具
- `ExpertDraft ↔ draft` 双向同步、流式去重和目标阶段后置迁移保护
- Core 文稿持久化、diff、接受 / 拒绝、技能 / 素材显式附加 UI、会话历史落盘

当前验收：Desktop / Contracts / Shared / Pi Adapter 全部类型检查、Renderer 边界检查、7 个测试文件共 51 项测试、生产构建、Renderer 产物 smoke 和真实 Electron Utilities + Pi/Faux 流式 smoke 均通过；并用 1120 × 720 的安全 Renderer 预览检查短篇树、五智能体设置和分节调度说明，页面无控制台错误。
