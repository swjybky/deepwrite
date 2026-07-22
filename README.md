# DeepWrite

DeepWrite 是面向创作工作流重构的新一代本地桌面客户端。当前已完成桌面骨架、Pi Agent 流式链路、真实模型配置和第一版 Core Catalog：短篇拥有人物、剧情三子阶段、大纲、正文六个内容槽位及五个智能体身份 / 配置；正文通过右侧横向 Tab 切换稳定小节，选择具体小节会进入独立分节写手会话。素材库、技能库、分组、短篇书籍及书籍绑定由 Core Utility 保存，素材 / 技能分组可从对应资料树的“＋”菜单创建并为每一种类型可选一个已有库。智能体对话会在本地恢复，写回先形成可审阅 diff，接受后自动保存到项目 Markdown。自动批量分节调度和资料库分组编辑 / 删除仍待接通。

## 当前界面

```text
左侧：固定功能 + 创作空间树 + 技能库树 + 素材库树
中间：独立智能体对话
右侧：文稿 / 技能 / 素材文本内容
```

左侧固定功能按产品要求依次为：新建对话、工作目录、模型配置、学习仿写、更多功能。Catalog 会投影为三棵真实资源树：素材库按“用途 kind → 题材 → 可选子题材 → 素材库 → 阶段 → 条目”浏览，技能库按“技能分类 → 技能库 → 阶段 → 条目”浏览，素材 / 技能分组作为额外入口保留。浏览资料只切换右侧内容，不会改变主创作文稿。

短篇正文父节点和导语、第一节等动态小节继续显示在左侧树中：选择正文父节点使用正文专家总控，选择具体小节使用分节写手。正文父节点行末提供“＋”，可按顺序手工追加小节；每个小节行末提供“···”菜单和带确认的删除操作。右侧横向 Tab 独立切换编辑器内容，不改变左侧树的选中项。小节正文和人物状态共用一份带稳定 section id 的 Markdown 真值，内部 marker 不暴露给编辑器，分节工具只能修改当前小节，并继续服从版本校验、可读 diff 审阅和本地原子保存。

新建短篇时可选择“世情 / 追妻 / 科幻 / 悬疑 / 其他”，并按 kind 单独选择素材库、技能库，或一次选择资料库分组。绑定关系随书籍保存；从该书籍发送消息时，符合绑定分类的真实素材 / 技能条目会形成 `attachedMaterials` / `attachedSkills`，再由当前智能体的读取范围继续过滤后交给查询和加载工具。超出附件容量或单条长度时会显式提示，不会静默假装完整。

书籍、素材库、技能库及两类分组现在各自对应一个本地项目文件夹：根目录的 `deepwrite.json` 只保存元数据、内容相对路径和绑定，书籍阶段、素材条目、技能条目正文分别保存在 UTF-8 Markdown 文件中。用户可随时切换工作目录；后续新书、素材库和技能库分别默认创建到工作目录的 `books/`、`materials/`、`skills/`，已注册项目仍保留原路径，不会随切换迁移。三棵资源树的“＋”菜单可以打开已有项目，创作空间还可选择旧版书籍 ZIP 并转换为当前文件结构；书籍、素材库和技能库都可选择只解除注册并保留文件夹，或在风险确认后连同本地项目文件夹一起删除。素材库和技能库还支持新增、编辑、删除 Markdown 条目。这些目录可直接交给 Cursor、Git 或同步盘管理。两类分组已文件夹化并完成旧数据迁移与新建 UI / API，分组编辑和删除仍是后续范围。

编辑中的未保存草稿不会写进项目 manifest，而是防抖、原子地保存在 Electron `userData/draft-recovery.json`；窗口关闭时的 `localStorage` 只作为同步应急副本。用户手工编辑仍在显式保存后写回项目 Markdown；智能体写回会按“待审阅 diff → 接受 / 拒绝”处理，接受后自动通过 Core 原子保存，拒绝不改变正文。外部版本冲突会保留最新草稿，不会静默覆盖。

## 本地目录与 Write Claw 迁移

Core 首次启动会先兼容读取现有 `catalog.json`，或合并当前 Write Claw 运行时 `.data` 与可发现的 `openwrite/write-claw/.data`。归一化后的每本书、每个素材库、技能库和分组会被拆分到 `userData/catalog-projects/` 下的独立项目文件夹，路径与迁移元数据保存在轻量的 `catalog-registry.json` 中；旧 `catalog.json` 保留为兼容来源，不再是新内容的写入真源。

文件夹注册表一旦建立，后续启动只读取注册项目，不再把旧 Catalog 同步回来，因此用户移除的项目不会在重启后复活，已经拆出的 Markdown 也不会被旧快照覆盖。`catalog-registry.json.bak` 保存最近一次可用索引：主注册表损坏时会自动恢复；主备均不可用时会保留带 `.corrupt-*` 后缀的损坏主文件并重建空索引，项目文件夹本身不会被删除，可通过“打开已存在…”重新注册。

自动迁移有意不读取 `books.json`，因此旧 Write Claw 书籍不会在启动时隐式进入 DeepWrite。需要迁移时，可在创作空间“＋”菜单选择“导入旧版书籍”，读取旧版导出的 ZIP；核心六阶段会映射到当前短篇结构，其他非空旧阶段作为“其他文稿”保留，并在当前工作目录的 `books/` 下生成新的 `deepwrite.json + stages/*.md` 项目。

## 启动

要求 Node.js 24+ 与 pnpm 11+。

```bash
pnpm install
pnpm dev
```

`pnpm dev`、`pnpm preview` 和 `pnpm smoke` 会先校验当前主机的 Electron 二进制；如果依赖重装时跳过了 Electron 安装脚本，会自动按当前系统和架构恢复 `dist` 与 `path.txt`，避免出现 `Electron uninstall`。

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

测试安装包统一从仓库根目录运行 `pnpm pack:test:*`。这些入口由 `tools/run-test-package.mjs` 串行执行完整校验、electron-builder、安装包验证和冒烟，并显式传入锁定的 Electron 版本。无论打包成功还是中途失败，退出前都会恢复并复查本机开发用 Electron，打包产物不会再让后续 `pnpm dev` 失效。

## 架构边界

- Renderer：三栏 UI 和交互，不接触 Node、文件、数据库、Pi SDK 或密钥。
- Preload：只暴露 `window.deepwrite.*` 语义 API，并校验双向协议。
- Main：窗口生命周期、Utility 监督、安全外链和 IPC 路由。
- Core Utility：本地项目和路径注册表的唯一写入者；串行校验并以临时文件 + rename 原子替换单个 `deepwrite.json` 或 Markdown。一次操作同时更新 Markdown 与 manifest 时，普通写入失败会恢复原 Markdown；若进程恰好在两次 rename 之间崩溃，仍可能留下跨文件版本不一致，严格崩溃原子性需要后续增加事务 journal。
- Agent Utility：运行锁定版本的 Pi Agent Adapter；支持本地 Faux 与 OpenAI Completions / Responses、Anthropic Messages、Google Generative AI 兼容 Provider，按“短篇作品 + 智能体”隔离多轮上下文，并限制同会话并发。
- Tool Utility：为未来有副作用的工具执行预留，必须在 Policy / Approval 后使用。

当前已经可以创建 / 打开素材库和技能库，并新增、编辑、删除其中的 Markdown 条目；也可新建允许空成员的素材 / 技能分组。尚未完成资料库元数据编辑、分组编辑 / 删除、结构化 `ExpertDraft` 与分节写手后台调度。

更详细的边界和迁移映射见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，阶段状态见 [docs/PHASE_STATUS.md](docs/PHASE_STATUS.md)。
