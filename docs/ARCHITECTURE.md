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

事件允许先于 accepted 到达；Renderer 用 attempt、session、run 三层身份隔离迟到受理、重复事件和旧会话事件。Agent Utility 同一会话只允许一个活动运行，Adapter 在超时、shutdown 或消费者提前结束时会 abort 底层 Agent。

## 3. Renderer 组件边界

- `App.vue`：管理三栏折叠、浏览资源、逐资源内存草稿，以及人物 / 剧情 / 大纲 / 正文协调四套可见会话。
- `LeftSidebar.vue`：五个固定入口与三个独立资源树。
- `TreeSection.vue` / `TreeNodeItem.vue`：通用递归树，不绑定旧项目存储。
- `AgentConversation.vue`：产品自有消息类型、Thinking / 流式正文展示、错误态、模型与思考等级选择器。
- `RightEditorPane.vue`：独立业务插槽，可承载正文、设定、技能、素材和账本。
- `WorkspaceDialog.vue`：工作目录、模型配置与仿写；模型配置包含 CRUD、默认模型、模型级默认思考等级和连接测试。
- `SettingsPage.vue` / `ShortAgentSettingsPanel.vue`：配置短篇五智能体的系统提示词和工作区、素材、技能读取范围。

Renderer 不直接依赖 Pi SDK。`useAgentConversation.ts` 只消费 `window.deepwrite` 的产品协议，并处理事件先到、重复事件、身份冲突、空闲超时和新会话失效。

## 4. 当前上下文语义

- 创作空间中最后选择的创作资源是 Agent 的主上下文。
- 右侧未应用草稿在发送瞬间形成不可变快照；收起右栏或浏览其他资源不会让可见草稿与发送内容分叉。
- 浏览技能或素材不会自动附加，右侧明确显示“仅浏览 · 未附加”。
- `attachedSkills` / `attachedMaterials` 已在协议中预留并使用不同 source schema，但 Slice 2 的 UI 不会填充它们。
- 快照正文最多 20,000 字符；超限时必须同时发送 `truncated=true` 与 `originalLength`，Faux 回复会如实提示截断。
- 普通短篇阶段已装配读取、搜索、素材查询、技能加载、阶段切换、整段写入和唯一片段替换工具；工具事件只更新 Renderer 内存草稿，不代表落盘。
- 各阶段发送给 Agent Utility 的文本上限仍为 20,000 字符；截断阶段允许读取和搜索，但禁止整段写入、正文骨架重建和局部替换，避免用不完整快照覆盖未见到的正文尾部。
- 每部作品的人物、剧情、大纲和正文协调分别保留自己的内存会话；剧情设计、导语设计和剧情细化共用该作品的 `plot_design` 会话，不跨作品复用。
- 运行期间只锁定当前智能体可写的编辑阶段，防止用户输入与工具写回竞争；mutation 还携带发送时的 `baseRevision`，Renderer 只在版本一致且 run 仍活动时应用，否则把对应工具标为冲突失败并用浮层提示。
- 传给模型的作品位置、runId 和附件目录只在本轮请求中临时注入；run 结束后 transcript 只保留原始用户消息，避免动态上下文污染多轮历史。

## 5. 模型配置与密钥边界

- 非敏感模型元数据保存在 Electron `userData/config/models.json`。
- API Key 由 Electron `safeStorage` 加密后单独保存在 `userData/config/model-secrets.json`；安全存储不可用时拒绝明文落盘。
- `window.deepwrite.models.list()` 只返回 `hasApiKey`，不会把密钥明文送回 Renderer。
- Renderer 发送 `session.prompt` 时只携带模型配置 ID；Main 解析默认模型、模型级默认思考等级和密钥后，构造内部 `agent.prompt`。
- Main 明确拒绝 Renderer 直接调用 `agent.prompt` / `agent.model_test`，避免 Renderer 自行注入运行时密钥配置。
- 连接测试与正式对话都由 `PiAgentRuntimeAdapter` 构造同一 Provider Model，避免“测试通过但实际对话走了另一模型”的配置漂移。
- 没有真实模型配置时才使用 DeepWrite Faux；Faux 是本地链路验证回退，不会伪装成真实 Provider。

## 6. 短篇迁移边界

短篇设计以 `/home/swj/project/swj/yonquan-write/write-claw` 当前实现为参考，但按 DeepWrite 的进程和协议边界重写：

- 六个内容槽位：`character_design`、`plot_design`、`intro_design`、`plot_refine`、`outline`、`draft`。
- 五个智能体：人物、剧情、大纲、正文专家协调、分节写手；三个剧情子槽位共用剧情智能体。
- Main 进程把五份内置系统提示词和读取范围保存到 `userData/config/workspace-agents.json`，Renderer 只能通过语义化 Preload API 读写。
- 普通阶段工具与正文骨架初始化、正文局部编辑已经接通；正文 `ExpertDraft` 结构、分节写手后台顺序调度和人物状态工具仍属于后续迁移。
- 短篇写回当前是可见的 Renderer 草稿变更，不经过 Tool Utility，也没有文件副作用；接入 Core 持久化前不能声称已经保存作品。

## 7. 旧 Write Claw 迁移映射

后续按领域适配，不整页复制：

| DeepWrite 目标 | 旧项目参考边界 |
|---|---|
| 创作空间树 | `web/src/components/WorkspaceTreeNav.tsx`、`web/src/workspaces/long/LongWorkspaceTree.tsx` |
| 智能体对话 | `web/src/pages/bookEditor/WorkspaceAiPanel.tsx`、`web/src/components/WorkspaceAiChat.tsx` |
| 文本编辑 | `web/src/pages/bookEditor/WorkspaceEditorPane.tsx`、`web/src/workspaces/long/LongWorkspaceEditor.tsx` |
| 学习仿写 | `web/src/features/learningImitation/` |
| 技能库 | `web/src/pages/SkillEditor.tsx` 与 bridge 领域类型 |
| 素材库 | `web/src/pages/MaterialEditor.tsx` 与 bridge 领域类型 |
| 模型配置 | `web/src/bridge/aiModelConfig.ts` 的字段语义，不复制任何密钥或持久化实现 |

旧项目的 `Home.tsx`、`BookEditor.tsx` 和 `WorkspaceAiChat.tsx` 高度耦合，不能直接成为新壳层依赖。旧配置中的硬编码密钥也绝不迁移；发布版模型密钥必须使用 Electron `safeStorage` 或系统 Keychain。

## 8. 下一切片

下一批短篇同步优先迁移结构化 `ExpertDraft`、正文与人物状态一一对应关系、单节写手和后台顺序调度；随后接入 Core 持久化、diff 与接受 / 拒绝流程。技能 / 素材显式附加 UI、会话历史落盘和旧 Write Claw 数据导入仍单独设计。
