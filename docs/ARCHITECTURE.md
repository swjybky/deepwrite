# DeepWrite 桌面客户端架构

## 1. 目标

DeepWrite 采用“左侧资源与功能、中间智能体对话、右侧文本内容”的三栏结构。它参考 PersonalClaw 已验证的桌面边界和 Codex 客户端的中性视觉语言，但不复制 PersonalClaw 的任务业务，也不直接搬运旧 Write Claw 的大页面。

右侧是长期写作区，因此宽度从参考框架的窄业务栏适配为 `clamp(410px, 34vw, 650px)`；左右栏仍可独立折叠。

## 2. 进程边界

```text
Vue Renderer
    │ window.deepwrite.*
    ▼
Preload 白名单 + Zod 双向校验
    │ versioned Envelope
    ▼
Electron Main
    ├── Core Utility   创作数据与业务状态唯一写入者
    ├── Agent Utility  Pi Agent / Provider / 流式事件
    └── Tool Utility   经 Policy 与 Approval 的副作用工具
```

当前已经建立安全 BrowserWindow、版本化命令 / 事件协议、三个 Utility 的 ready / heartbeat / health / shutdown，以及异常退出后的重启入口。Slice 2 完成了 `session.prompt` 的快速受理和 Agent 流式事件链；Slice 3 在不向 Renderer 暴露密钥的前提下加入了真实 Provider；Slice 4 开始在同一边界内装配短篇阶段智能体和无磁盘副作用的工作区工具：

Catalog 写入遵循同一进程边界：

```text
Renderer window.deepwrite.catalog.*
  → Preload 校验 Catalog 命令与返回值
  → Main 为新建 / 打开操作弹系统目录选择器
  → Main 以 Renderer 无法直接调用的受信路径命令转发 Core Utility
  → Core 校验 manifest、项目类型、真实路径与内容版本
  → 串行提交项目 deepwrite.json 与 Markdown；单文件原子替换，普通跨文件失败回滚
```

```text
Renderer send
  → Preload 构造并校验 session.prompt
  → Main 校验并解析所选或默认模型
  → safeStorage 解密本轮所需 API Key
  → Main 根据可信的短篇 activeStageId 选择用户配置的智能体
  → Main 构造 Renderer 无法直接调用的 agent.prompt
  → Agent Utility 快速返回 sessionId / runId / runtime
  → Pi Adapter 驱动真实 Provider；无配置时驱动本地 Faux
  → Thinking / message / tool / workspace mutation 事件
  → Main 广播并由 Renderer 按 sessionId + runId + messageId 归并
```

事件允许先于 accepted 到达；Renderer 用 attempt、session、run 三层身份隔离迟到受理、重复事件和旧会话事件。Agent Utility 同一会话只允许一个活动运行，Adapter 不限制流式运行总时长；连续 5 分钟没有正文、思考或工具事件时，或在 shutdown、消费者提前结束时，会 abort 底层 Agent。

## 3. Renderer 组件边界

- `App.vue`：管理三栏折叠、浏览资源、逐资源内存草稿，以及人物 / 剧情 / 大纲 / 正文协调 / 每个正文小节相互隔离的可见会话；左侧正文树控制智能体上下文，右侧横向 Tab 独立控制编辑器投影。
- `LeftSidebar.vue`：五个固定入口与三个独立资源树。
- `TreeSection.vue` / `TreeNodeItem.vue`：通用递归树，不绑定旧项目存储。
- `AgentConversation.vue`：产品自有消息类型、Thinking / 流式正文、工具轨迹、变更 diff 与接受 / 拒绝状态，以及模型和思考等级选择器。
- `RightEditorPane.vue`：独立业务插槽，可承载正文、设定、技能、素材和账本。
- `CreateShortBookDialog.vue`：新建短篇、选择保存父目录和题材，并按 kind 或资料库分组建立素材 / 技能绑定。
- `catalogWorkspace.ts`：将持久化 Catalog 投影为创作空间、技能库、素材库三棵资源树及右侧文档。
- `libraryAttachments.ts`：把书籍的 by-kind 绑定解析为协议有效的素材 / 技能附件，并显式报告截断或遗漏。
- `WorkspaceDialog.vue`：工作目录、模型配置与仿写；模型配置包含 CRUD、默认模型、模型级默认思考等级和连接测试。
- `SettingsPage.vue` / `ShortAgentSettingsPanel.vue`：配置短篇五智能体的系统提示词和工作区、素材、技能读取范围。

Renderer 不直接依赖 Pi SDK。`useAgentConversation.ts` 只消费 `window.deepwrite` 的产品协议，并处理事件先到、重复事件、身份冲突、空闲超时和新会话失效；最近会话及尚未处理的编辑提案会按“作品 + 智能体”保存在本地，恢复中的 `accepting` 会回退为可重新审阅的 `pending`。

## 4. 当前上下文语义

- 创作空间中最后选择的创作资源是 Agent 的主上下文。
- 右侧未应用草稿在发送瞬间形成不可变快照；收起右栏或浏览其他资源不会让可见草稿与发送内容分叉。
- 浏览技能或素材不会自动改变当前书籍绑定；只有书籍已保存的 by-kind 绑定参与本轮 Agent 上下文。
- 发送 Catalog 短篇消息时，Renderer 从当前 Catalog 快照解析真实条目并填充 `attachedSkills` / `attachedMaterials`。素材条目按阶段映射到 material kind，技能条目继承技能库 kind；Pi 工具随后根据当前 Agent 的读取范围再次过滤。
- 资料库概述不进入附件；单域最多 64 条、单条最多 20,000 字符，容量遗漏和正文截断会产生结构化诊断并通过浮层提示用户。
- 快照正文最多 20,000 字符；超限时必须同时发送 `truncated=true` 与 `originalLength`，Faux 回复会如实提示截断。
- 对话输入框支持 TXT、Markdown、PDF 及 PNG / JPEG / WebP / GIF。Renderer 直接读取纯文本，使用 PDF.js worker 提取 PDF 文本；扫描版 PDF 没有文本层时通过浮层提示先做 OCR。单条消息最多 8 个附件，文本和图片分别执行单文件与总量上限，截断或拒绝都不会静默发生。
- 用户文本附件会连同文件名和截断标记写入 User Message 文本上下文；图片以 Pi `image` 内容块携带 base64 和 MIME 类型进入模型多模态链路。自定义模型端点保留图片块，由 Provider 明确报告能力错误；Pi 内置目录标记为纯文本的模型和本地 Faux 会在请求前明确拒绝图片。
- 普通短篇阶段已装配读取、搜索、素材查询、技能加载、阶段切换、整段写入和唯一片段替换工具；写工具提交待审阅变更，同一 run、同一阶段的连续写入会合并为一份最终提案。
- 正文父节点与动态小节树节点指向同一份 draft Markdown，不复制第二份文稿。选择父节点时保留正文总控会话，选择左侧具体小节时携带经契约校验的稳定 section id 并进入分节写手；右侧横向 Tab 只切换编辑器内容，不反向改变树选择。父节点行末“＋”按现有最大编号追加空小节，小节行末“···”提供带确认的删除操作；增删结果先进入可恢复草稿，应用时确定性合并回源 Markdown。
- draft Markdown 的显式 marker 保存小节 id、字数要求和人物状态；marker 不进入正文总览或编辑器，人物状态在审阅 diff 中以可读文本展示。分节写手的读取、正文写入 / 替换、人物状态写入 / 替换均锁定当前小节，结果继续走完整 draft 的 revision、diff、接受 / 拒绝与原子保存链。
- 各阶段发送给 Agent Utility 的文本上限仍为 20,000 字符；分节路由另随快照携带完整 section id 索引，因此截断点之后的合法小节仍可通过 Main 校验。截断阶段允许读取和搜索已提供的前段内容，但禁止整段写入、正文骨架重建和局部替换，避免用不完整快照覆盖未见到的正文尾部。
- 每部作品的人物、剧情、大纲和正文协调分别保留自己的内存会话；每个正文小节按稳定 id 隔离分节写手会话；剧情设计、导语设计和剧情细化共用该作品的 `plot_design` 会话，不跨作品复用。
- 运行期间锁定当前智能体可写的编辑阶段，防止用户输入与工具写回竞争；mutation 携带 `baseRevision`，Renderer 在提案进入审阅和用户接受时各校验一次。接受期间同一作品的编辑与保存串行化；版本冲突只更新提案状态并用浮层提示，不覆盖最新草稿。
- 传给模型的作品位置、runId 和资料库附件目录只在本轮请求中临时注入；run 结束后 transcript 保留原始用户消息及用户上传的文本 / 图片附件，但移除动态工作区包装，避免动态上下文污染多轮历史。

## 5. Core 文件夹项目与旧数据迁移

- `packages/contracts/src/catalog.ts` 定义短篇书籍、素材 / 技能库、两类分组以及五种 `deepwrite.json` 文件夹清单；清单只保存相对 Markdown 路径，不允许内联正文。
- Core Utility 是项目文件的唯一写入者。`catalog-registry.json` 只记录已打开资源的稳定 ID、绝对路径和迁移元数据；运行时 `CatalogSnapshot` 每次从注册项目重新读取并聚合，不再是磁盘真源。`catalog-registry.json.bak` 保留最近一次可用索引，主文件损坏时自动恢复；主备均不可用时保留 `.corrupt-*` 主文件并重建空索引，用户可从仍为数据真源的项目文件夹重新“打开已存在…”。
- 每本书、每个素材库、技能库及分组都是独立文件夹。书籍阶段位于 `stages/*.md`，素材和技能条目位于 `entries/*.md`，根 `deepwrite.json` 保存标题、类型、时间、相对路径及绑定关系。
- 工作目录由 Main 选择并持久化，可随时切换；后续新建书籍、素材库、技能库分别写入其 `books/`、`materials/`、`skills/` 子目录，现有注册项目路径不变。打开现有项目和旧版书籍 ZIP 同样由 Main 授权，Renderer 不能提交任意文件路径。
- Core 对注册目录执行 realpath 去重、相对路径 containment、符号链接、UTF-8、文件大小和 Zod 校验；manifest 中指向同一 inode 的硬链接别名会被拒绝。自动分配 Markdown 路径时，会把 manifest 已使用路径和实际目录项都按 NFC 归一化、大小写折叠后视为已占用，避免覆盖大小写 / Unicode 规范化等价路径或 Cursor 创建的未跟踪文件。
- 单个文件均通过临时文件 + rename 原子替换。Markdown 与 manifest 的组合更新采用串行提交，普通写入失败时恢复原 Markdown；但进程若恰好在两次 rename 之间崩溃，仍可能留下跨文件版本不一致，这不是严格的多文件事务，彻底消除该窗口需要事务 journal 与启动恢复。
- 保存正文或资料条目时携带读取时的内容 revision。若 Cursor 等外部编辑器已经改动磁盘文件，Core 拒绝覆盖并保留 Renderer 草稿；窗口重新获得焦点时会重读项目快照。
- “移除书籍 / 资料库”当前语义是从注册表解除注册，不删除用户文件夹。删除素材或技能条目则会在风险确认后删除对应 Markdown；Core 先暂存文件，并在 manifest 提交失败时恢复。文件夹名默认由标题生成，但稳定身份来自 manifest UUID，改书名不会隐式移动目录。
- 未保存编辑草稿防抖、原子地写入 `userData/draft-recovery.json`，典型浏览器配额不再限制恢复容量；`localStorage` 仅是窗口卸载期间的应急同步副本。Main 退出前保留 500 ms IPC 缓冲，Core shutdown 再等待在途命令排空。
- 首次运行文件夹存储时，会兼容读取已有 `catalog.json`，或执行 Write Claw 自动引导迁移并一次性拆分完整快照。注册表建立后，后续启动不再把旧 Catalog 同步回来，避免已移除项目复活或旧正文覆盖 Markdown；旧 `catalog.json` 仅保留为兼容来源和备份。
- `catalog.json` 不存在时仍会合并当前 Write Claw 运行时 `.data` 与可发现或显式配置的 `openwrite/write-claw/.data`；同 ID 内容合并，跨 ID 只对标题兼容的明确 recovered 恢复副本去重。
- 自动迁移只读取 `materials.json`、`skills.json` 和 `preferences.json`：迁移素材、技能、`material_library_groups` 与 `skill_library_groups`，并保存全部来源路径、导入时间和 SHA-256 指纹。
- 自动迁移明确不读取 `books.json`，旧书籍不会因为资料库迁移而隐式出现在新创作空间。用户可显式导入旧版单书 ZIP：六个当前阶段直接映射，其他非空阶段、专家正文和书籍记忆作为额外 Markdown 文稿保留；封面暂不进入当前项目模型。
- 旧素材若缺少 `material_kind` 会作为 `mixed` 综合素材；纯阶段文本会转换为条目；`现实情感 / 情感` 归一为 `追妻`。旧技能的导语 / 剧情细化阶段归并到剧情技能，正文审阅 / 格式转换 / 专家协调阶段归并到正文技能。
- 素材树的规范浏览层级为“kind → 一级题材 → 可选子题材 → 素材库 → 阶段 → 条目”；技能树为“技能分类 → 技能库 → 阶段 → 条目”。两类分组是额外视图，成员库仍保留在规范分类树中。
- 新建短篇会在当前工作目录的 `books/` 中一次创建 manifest 和六个空阶段 Markdown，并保存素材 / 技能绑定；素材库和技能库分别在 `materials/`、`skills/` 创建，条目新增 / 编辑 / 删除均同步维护 `entries/*.md` 与 manifest。未保存的手工草稿不会自动提交；Agent 提案只有在用户接受后才自动提交，拒绝不会触碰项目文件。

## 6. 模型配置与密钥边界

- 非敏感模型元数据保存在 Electron `userData/config/models.json`。
- API Key 由 Electron `safeStorage` 加密后单独保存在 `userData/config/model-secrets.json`；安全存储不可用时拒绝明文落盘。
- `window.deepwrite.models.list()` 只返回 `hasApiKey`，不会把密钥明文送回 Renderer。
- Renderer 发送 `session.prompt` 时只携带模型配置 ID；Main 解析默认模型、模型级默认思考等级和密钥后，构造内部 `agent.prompt`。
- Main 明确拒绝 Renderer 直接调用 `agent.prompt` / `agent.model_test`，避免 Renderer 自行注入运行时密钥配置。
- 连接测试与正式对话都由 `PiAgentRuntimeAdapter` 构造同一 Provider Model，避免“测试通过但实际对话走了另一模型”的配置漂移。
- 没有真实模型配置时才使用 DeepWrite Faux；Faux 是本地链路验证回退，不会伪装成真实 Provider。

## 7. 短篇迁移边界

短篇设计以 `/home/swj/project/swj/yonquan-write/write-claw` 当前实现为参考，但按 DeepWrite 的进程和协议边界重写：

- 六个内容槽位：`character_design`、`plot_design`、`intro_design`、`plot_refine`、`outline`、`draft`。
- 五个智能体：人物、剧情、大纲、正文专家协调、分节写手；三个剧情子槽位共用剧情智能体。
- Main 进程把五份内置系统提示词和读取范围保存到 `userData/config/workspace-agents.json`，Renderer 只能通过语义化 Preload API 读写。
- 普通阶段工具、正文骨架初始化、正文局部编辑、动态小节树、单节分节写手及人物状态工具已经接通；`write_single_expert_section` / `start_expert_writing` 的后台顺序调度和子 run/job 协议仍属于后续迁移。
- 文件夹项目的新建 / 打开以及用户显式保存的阶段 Markdown 已由 Core 持久化。Agent 工具写回会生成有界的多 hunk 行级 diff；生成结束后用户可以接受或拒绝，接受会复核内容 revision 与项目 revision 并自动原子保存，拒绝保留原文。保存失败、外部改动和恢复期竞态都不会覆盖较新的草稿。

## 8. 旧 Write Claw 迁移映射

迁移继续按领域适配，不整页复制。当前状态如下：

| DeepWrite 目标 | 旧项目参考边界 | 当前状态 |
|---|---|---|
| 创作空间树 | `web/src/components/WorkspaceTreeNav.tsx`、`web/src/workspaces/long/LongWorkspaceTree.tsx` | 短篇六槽位已落地；旧 books 不自动迁移 |
| 智能体对话 | `web/src/pages/bookEditor/WorkspaceAiPanel.tsx`、`web/src/components/WorkspaceAiChat.tsx` | 阶段会话与真实绑定附件已接通 |
| 文本编辑 | `web/src/pages/bookEditor/WorkspaceEditorPane.tsx`、`web/src/workspaces/long/LongWorkspaceEditor.tsx` | 书籍阶段、素材与技能条目可显式保存；Agent 写回 diff、接受 / 拒绝和接受后自动保存已完成 |
| 学习仿写 | `web/src/features/learningImitation/` | 尚未迁移 |
| 技能库 | Renderer 资料树、Catalog contracts 与 Core folder store | 文件夹新建 / 打开 / 解除注册、条目 CRUD 及按 kind 新建分组已完成；元数据和分组编辑 / 删除未完成 |
| 素材库 | Renderer 资料树、Catalog contracts 与 Core folder store | 文件夹新建 / 打开 / 解除注册、条目 CRUD 及按 kind 新建分组已完成；元数据和分组编辑 / 删除未完成 |
| 模型配置 | `web/src/bridge/aiModelConfig.ts` 的字段语义，不复制任何密钥或持久化实现 | 模型 CRUD 与安全密钥存储已落地；旧配置不自动导入 |

旧项目的 `Home.tsx`、`BookEditor.tsx` 和 `WorkspaceAiChat.tsx` 高度耦合，不能直接成为新壳层依赖。旧配置中的硬编码密钥也绝不迁移；发布版模型密钥必须使用 Electron `safeStorage` 或系统 Keychain。

## 9. 下一切片

下一批优先补齐素材 / 技能库元数据编辑与分组编辑 / 删除、手动迁移预览与来源选择，以及 `write_single_expert_section` / `start_expert_writing` 的后台顺序调度、子 run/job 协议和旧书籍迁移。
