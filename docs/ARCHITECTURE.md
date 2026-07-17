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

当前已经建立安全 BrowserWindow、版本化命令 / 事件协议、三个 Utility 的 ready / heartbeat / health / shutdown，以及异常退出后的重启入口。Slice 2 还完成了 `session.prompt` 的快速受理和 Agent 流式事件链：

```text
Renderer send
  → Preload 构造并校验 session.prompt
  → Main 校验并交给 Supervisor
  → Agent Utility 快速返回 sessionId / runId / runtime
  → Pi Adapter 驱动本地 Faux
  → Thinking delta / message delta / completed | error
  → Main 广播并由 Renderer 按 sessionId + runId + messageId 归并
```

事件允许先于 accepted 到达；Renderer 用 attempt、session、run 三层身份隔离迟到受理、重复事件和旧会话事件。Agent Utility 同一会话只允许一个活动运行，Adapter 在超时、shutdown 或消费者提前结束时会 abort 底层 Agent。

## 3. Renderer 组件边界

- `App.vue`：管理三栏折叠、浏览资源、主创作上下文和逐资源内存草稿。
- `LeftSidebar.vue`：五个固定入口与三个独立资源树。
- `TreeSection.vue` / `TreeNodeItem.vue`：通用递归树，不绑定旧项目存储。
- `AgentConversation.vue`：产品自有消息类型、Thinking / 流式正文展示、错误态和输入器。
- `RightEditorPane.vue`：独立业务插槽，可承载正文、设定、技能、素材和账本。
- `WorkspaceDialog.vue`：工作目录、模型、仿写和更多功能的首期界面占位。

Renderer 不直接依赖 Pi SDK。`useAgentConversation.ts` 只消费 `window.deepwrite` 的产品协议，并处理事件先到、重复事件、身份冲突、空闲超时和新会话失效。

## 4. 当前上下文语义

- 创作空间中最后选择的创作资源是 Agent 的主上下文。
- 右侧未应用草稿在发送瞬间形成不可变快照；收起右栏或浏览其他资源不会让可见草稿与发送内容分叉。
- 浏览技能或素材不会自动附加，右侧明确显示“仅浏览 · 未附加”。
- `attachedSkills` / `attachedMaterials` 已在协议中预留并使用不同 source schema，但 Slice 2 的 UI 不会填充它们。
- 快照正文最多 20,000 字符；超限时必须同时发送 `truncated=true` 与 `originalLength`，Faux 回复会如实提示截断。
- 当前“应用”仅更新 Renderer 本次运行内的数据，不代表落盘；Agent 没有任何写回工具。

## 5. 旧 Write Claw 迁移映射

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

## 6. 下一切片

下一阶段进入真实模型与配置迁移：先迁移旧 Write Claw 的模型字段语义，使用 Electron `safeStorage` / 系统 Keychain 保存密钥，再在现有 Adapter 接口后增加 Provider Runtime。随后接入会话历史与 Core 持久化；文稿写回、技能 / 素材显式附加和工具执行仍需独立的 diff、Policy、Approval 与 Audit 设计，不与模型接入混做。
