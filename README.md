# DeepWrite

DeepWrite 是面向长篇创作重构的新一代本地桌面客户端。当前已完成桌面骨架与第二阶段 Agent 链路：Electron / Vue / TypeScript 三栏工作台可以把发送瞬间的主文稿快照交给 Pi Agent，并通过无需 API Key 的本地 Faux Runtime 流式返回 Thinking 与回复内容。

## 当前界面

```text
左侧：固定功能 + 创作空间树 + 技能库树 + 素材库树
中间：独立智能体对话
右侧：文稿 / 技能 / 素材文本内容
```

左侧固定功能按产品要求依次为：新建对话、工作目录、模型配置、学习仿写、更多功能。创作空间叶节点会切换主上下文；技能和素材叶节点目前只在右侧浏览，并明确标记“未附加”，不会悄悄替换主创作文稿。

右侧编辑内容是 Renderer 内存草稿：收起、展开和资源切换后仍保留，发送时读取可见的实时版本；“应用”只同步到本次运行，重启后不保留。本阶段还没有 Core 持久化或 Agent 写回能力。

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
- Agent Utility：运行锁定版本的 Pi Agent Adapter；当前只启用本地 Faux 模型，并限制同会话并发。
- Tool Utility：为未来有副作用的工具执行预留，必须在 Policy / Approval 后使用。

更详细的边界和迁移映射见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，阶段状态见 [docs/PHASE_STATUS.md](docs/PHASE_STATUS.md)。
