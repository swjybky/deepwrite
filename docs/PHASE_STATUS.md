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

状态：进行中（2026-07-18，多批能力已落地）

已落地：

- 按 Write Claw 当前短篇实现同步六个内容槽位与可见导航：人物、剧情（剧情设计 / 导语设计 / 剧情细化）、大纲、正文；正文小节在右侧以稳定的横向 Tab 切换
- 同步五个智能体身份、默认系统提示词和默认读取范围；三个剧情子阶段共用剧情智能体
- 设置页新增“创作 / 创作空间”，可编辑五份系统提示词和工作区、素材、技能读取范围，并支持按智能体恢复默认；分节写手明确标注调度尚未接通
- Main 使用 `userData/config/workspace-agents.json` 原子保存设置；必需阶段读取权限在 Main 再次补齐
- 每轮根据短篇 `activeStageId + activeAgentId + activeSectionId` 在 Main 复核并选择可信智能体；截断正文额外携带完整 section id 索引，正文父节点使用总控，具体小节使用分节写手，各小节保留独立多轮会话
- 普通阶段接通 `read_workspace_content`、`search_workspace_text`、`query_linked_material_entries`、`load_skill`、`switch_storyline_stage`、`write_workspace_editor`、`replace_current_stage_text`
- 正文 Markdown 通过显式 section marker 保存稳定 id、字数要求和不进入正文投影的人物状态；正文入口默认打开导语，父节点行末“＋”支持顺序追加，小节行末“···”支持确认删除；右侧 Tab 独立管理编辑器投影；空短篇默认导语与第一节，旧 `##` 小节和无标题正文会安全归一化
- 正文协调接通 `initialize_expert_draft` 和 `edit_expert_draft_section`；分节写手接通 `read_expert_draft_section`、`write_section_body`、`replace_section_body_text`、`write_character_state`、`replace_character_state_text`
- 分节写手写工具固定锁定当前树节点的小节，连续写正文和人物状态仍合并为同一份 draft Markdown 审阅提案；其它小节不会被同名片段误改
- 工具请求、结果、阶段切换和编辑器变更通过版本化事件返回；写工具形成待审阅提案，同一 run、同一阶段的连续写入合并为最终修改稿
- 截断阶段禁止整段写入、正文骨架重建和局部替换，避免 20,000 字符安全快照导致正文尾部丢失
- 编辑器在对应智能体运行中暂停手动输入；工具 mutation 在进入审阅与接受保存时分别以 revision 做乐观并发校验，迟到、重复事件或版本冲突不会覆盖最新草稿
- 作品位置、runId 与附件目录只做本轮动态注入，持久 transcript 会还原为用户原始消息
- Catalog 书籍的真实素材 / 技能绑定会在发送时解析为 `attachedMaterials` / `attachedSkills`，并继续服从当前智能体的读取范围

尚未迁移完成：

- `write_single_expert_section`、`start_expert_writing` 后台顺序调度
- 超过 20,000 字符的整份正文目前仍禁止分节写回；后续需把传输和 revision 边界下沉到单节
- 后台子 run / job 身份、初始化提案审批屏障、批量进度与取消恢复协议

当前验收：Desktop / Contracts / Shared / Pi Adapter 全部类型检查、Renderer 边界检查、23 个测试文件共 170 项测试和生产构建均通过；此前的 Renderer 产物 smoke、真实 Electron Utilities + Pi/Faux 流式 smoke，以及 1120 × 720 安全 Renderer 预览检查也已通过，页面无控制台错误。

## Slice 5：Core Catalog、资料库迁移与短篇绑定

状态：文件夹项目改造已落地（2026-07-19）

已落地：

- 新增版本化 Catalog 契约、五种 `deepwrite.json` 项目清单，以及项目新建 / 打开 / 解除注册、条目创建 / 保存 / 删除等类型安全语义命令
- Core Utility 是文件夹项目唯一写入者；书籍阶段、素材条目和技能条目写入独立 Markdown，每个文件均以临时文件 + rename 原子替换；Markdown 与 manifest 的普通提交失败会回滚原 Markdown，但进程在两次 rename 间崩溃的严格原子性仍需事务 journal
- `catalog-registry.json` 只保存项目 ID、授权路径和迁移元数据；运行时 Catalog 快照从所有注册项目重新聚合。`.bak` 保存最近一次可用索引，主文件损坏时自动恢复；主备均损坏时保留 `.corrupt-*` 主文件、重建空索引，并允许重新打开原项目文件夹
- 工作目录可通过系统目录选择器持久化并随时切换；新书、素材库、技能库默认落入 `books/`、`materials/`、`skills/`，现有注册项目不迁移；“＋”菜单支持打开已有项目，创作空间还支持导入旧版单书 ZIP。Renderer 无法直接调用含本地路径的内部命令
- 文件存储校验 realpath、路径 containment、符号链接、UTF-8、大小与 manifest schema；保存携带正文 revision，拒绝覆盖 Cursor 等外部编辑器的新版本。新 Markdown 路径按 NFC + 大小写折叠检查 manifest 路径和实际目录项，不会覆盖未跟踪文件，并拒绝 manifest 中指向同一 inode 的硬链接别名
- Catalog 不存在时自动合并当前 Write Claw 运行时 `.data` 与可发现 / 显式配置的 `openwrite/write-claw/.data`；只迁移 `materials.json`、`skills.json`、`preferences.json` 中的素材、技能及两类分组，记录全部来源与指纹，不读取或迁移 `books.json`
- 旧 Catalog 只覆盖部分来源时执行一次缺失来源补迁，现有书籍、文稿和条目优先；已覆盖来源后续变化不会被启动流程重复拉取
- 兼容旧素材纯阶段文本、缺少 kind 的综合素材、旧技能阶段键和旧题材名称；旧技能阶段归并到当前五阶段模型
- Renderer 将 Catalog 投影为真实资源树：素材按“kind → 一级题材 → 可选子题材 → 库 → 阶段 → 条目”，技能按“分类 → 库 → 阶段 → 条目”，两类分组提供额外浏览入口
- 新建短篇弹窗支持五种题材，并可按素材 5 kind、技能 4 kind 单独选择资料库，或直接选择一个资料库分组；Core 在创建时校验 short 类型与 kind 对应关系并保存绑定
- 新书在当前工作目录的 `books/` 中创建项目文件夹、根 manifest 和六个短篇阶段 Markdown；旧版 ZIP 导入会映射六个当前阶段并保留其他非空文稿；书籍改名和绑定更新写 manifest，“删除”只移除注册而不删除用户文件
- 素材库、技能库及两类分组同样迁移为独立文件夹；素材与技能库支持新建 / 打开 / 解除注册，条目支持创建、右侧显式保存和风险确认后删除对应 Markdown
- 未保存草稿防抖原子写入 Core `draft-recovery.json`，关闭时保留同步应急副本；外部编辑冲突可保留草稿、重新加载磁盘版本或明确强制覆盖
- 发送 Catalog 短篇消息时，绑定库条目会转换为真实 `attachedMaterials` / `attachedSkills`；素材按阶段映射到 kind，技能按库分类附加，Pi 工具再依据智能体读取范围查询或加载
- 附件构建对缺库、分类不匹配、重复绑定、容量溢出和内容截断提供显式诊断；库概述只用于浏览，不会误当成素材或技能正文附件
- 已增加 Catalog 契约、Core 存储 / 旧数据迁移、资源树投影、资料库附件、草稿恢复及 stale / force 冲突的针对性测试

当前验收：`pnpm typecheck`、`pnpm lint`、15 个测试文件共 112 项测试、生产构建、Renderer 产物 smoke 和真实 Electron Utilities + Pi/Faux 流式 smoke 全部通过。

仍未完成：

- 素材 / 技能分组已文件夹化并完成旧数据迁移；两棵资料树的“＋”菜单可新建分组，并按每种 kind 可选一个已有库（允许全部留空），创建后成员库会在分组节点下显示。分组编辑 / 删除以及素材库 / 技能库元数据编辑与重命名仍待补齐
- 手动选择 Write Claw 来源、迁移预览、重复导入或持续增量同步 UI；当前只有自动引导迁移与缺失来源一次性补迁
- 旧 Write Claw 书籍、正文、记忆、封面及书籍绑定迁移
- 跨会话长期记忆及 steer
- 结构化 `ExpertDraft`、分节写手后台顺序调度

## Slice 6：Agent 变更审阅与自动持久化

状态：已完成（2026-07-19）

已落地：

- Agent 写工具不再直接覆盖 Renderer 草稿，而是生成跟随会话保存的待审阅提案；同一 run、同一阶段的多次连续写入按基础 revision 串联合并
- 提案展示有界的多 hunk 行级 diff、原 / 新行号及完整 `+/-` 统计；Myers 计算具有工作量和内存硬预算，超限时退化为安全的粗粒度 diff 并明确标注截断
- 生成完成前禁止审阅；完成后可“接受并保存”或“拒绝”。拒绝不改变正文，接受会再次校验实时文稿版本，再调用 Core 原子保存 Markdown
- 接受期间按作品串行化编辑和保存，并锁定对应编辑区；外部文件或项目 revision 变化会转为冲突状态和浮层提示，不提供静默覆盖
- 保存成功后只清理接受开始时的同一份草稿；保存期间出现的新草稿会继续保留。若 Core 已保存但 Renderer 在状态收敛前退出，恢复后会识别磁盘上的提案版本并安全完成状态
- `workspace.editor_mutation` 按事件 ID 和工具调用结果幂等去重；待审阅 / 接受中状态会阻止同一会话继续发送，避免后续模型基于尚未生效的文本工作
- 最近会话、diff 和未决提案可本地恢复；进程中断时的 `accepting` 会恢复为 `pending`，允许依据当前磁盘版本重新判断
- 对话滚动改为仅在用户原本贴底时按帧跟随，不再逐 token 强制平滑滚动；手工保存也改为由父层真实保存结果驱动 dirty / saving 状态

当前验收：`pnpm typecheck`、`pnpm lint`、21 个测试文件共 144 项测试、生产构建、Renderer 产物 smoke、真实 Electron Utilities + Pi/Faux smoke 及本地 diff 卡片可见验收全部通过；预览控制台无错误。
