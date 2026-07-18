# DeepWrite

DeepWrite 是面向创作工作流重构的新一代本地桌面客户端。当前已完成桌面骨架、Pi Agent 流式链路和真实模型配置，并开始同步 Write Claw 的短篇设计：已经落地人物、剧情三子阶段、大纲、正文六个内容槽位和五个智能体身份 / 配置；当前按阶段运行人物、剧情、大纲、正文协调四类会话，分节写手调度仍待接通。系统提示词与读取范围可在设置页配置。

## 当前界面

```text
左侧：固定功能 + 创作空间树 + 技能库树 + 素材库树
中间：独立智能体对话
右侧：文稿 / 技能 / 素材文本内容
```

左侧固定功能按产品要求依次为：新建对话、工作目录、模型配置、学习仿写、更多功能。创作空间叶节点会切换主上下文；技能和素材叶节点目前只在右侧浏览，并明确标记“未附加”，不会悄悄替换主创作文稿。

右侧编辑内容是 Renderer 内存草稿：收起、展开和资源切换后仍保留，发送时读取可见的实时版本；“应用”只同步到本次运行，重启后不保留。短篇普通阶段智能体已可通过受限工具读取、检索、整段写入或局部替换这些内存草稿，但本阶段仍没有 Core 持久化、diff 或接受 / 拒绝流程。

## 启动

要求 Node.js 24+ 与 pnpm 11+。

```bash
pnpm install
pnpm dev
```

浏览器内单独预览已构建的 Renderer：

```bash
pnpm build
python3 -m http.server 4178 --bind 127.0.0.1 \
  --directory apps/desktop/out/renderer
```

## 验证

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm smoke:renderer
pnpm smoke
```

`pnpm lint` 会硬性阻止 Renderer 导入 Node、Electron、SQLite 或 Pi Runtime。`pnpm smoke` 会启动真实 Electron 构建，检查 Core / Agent / Tool 三个 Utility 的健康状态，并验证 Pi/Faux 的 Thinking、多段文本 delta 与唯一完成终态。

## 架构边界

- Renderer：三栏 UI 和交互，不接触 Node、文件、数据库、Pi SDK 或密钥。
- Preload：只暴露 `window.deepwrite.*` 语义 API，并校验双向协议。
- Main：窗口生命周期、Utility 监督、安全外链和 IPC 路由。
- Core Utility：后续作为创作数据唯一写入者。
- Agent Utility：运行锁定版本的 Pi Agent Adapter；支持本地 Faux 与 OpenAI Completions / Responses、Anthropic Messages、Google Generative AI 兼容 Provider，按“短篇作品 + 智能体”隔离多轮上下文，并限制同会话并发。
- Tool Utility：为未来有副作用的工具执行预留，必须在 Policy / Approval 后使用。

更详细的边界和迁移映射见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，阶段状态见 [docs/PHASE_STATUS.md](docs/PHASE_STATUS.md)。
