# DeepWrite

[中文](./README.md) · [English](./README.en.md) · [下载安装包](https://github.com/swjybky/deepwrite/releases)

> 面向创作者的本地优先 AI 写作智能体工作台。

DeepWrite 将模型、提示词、写作技能、素材、文稿和工具组织在同一个桌面应用中。智能体可以理解当前作品的上下文，参与人物、剧情、大纲和正文创作，调用受控工具修改真实文稿，并将每一次变更交给你审阅。

![DeepWrite 主工作台：左侧资源树、中间智能体对话、右侧内容编辑器](./docs/images/workspace-overview.png)

## 主要特性

- **三栏写作工作台**：在同一界面管理项目与上下文、和智能体协作、阅读或编辑实际内容。
- **面向流程的专业智能体**：按人物、剧情、大纲、正文和分节写作等阶段组织不同职责。
- **可审阅的文稿修改**：所有写入先展示差异，接受后才保存，避免智能体静默覆盖正文。
- **本地优先的数据管理**：作品以 `deepwrite.json` 和 UTF-8 Markdown 文件保存，可使用 Git、同步盘或其他文本工具继续管理。
- **自选模型与服务**：支持添加自己的模型服务，并按智能体或任务切换模型与思考等级。
- **素材库、技能库与子智能体**：按作品绑定所需资料与能力，也可以组建子智能体团队处理复杂任务。
- **拆书与写作分析**：短篇与长篇拆书、修改分析和文风比对，把分析结果沉淀为可复用的素材或技能。

## 工作方式

### 在一个视野内完成创作

DeepWrite 参考 Codex 的交互方式，将写作过程中最常用的内容放进清晰的三栏布局：

- 左侧：作品、章节、素材库、技能库与常用功能
- 中间：智能体对话、思考过程、工具执行与修改建议
- 右侧：人物、剧情、大纲、正文、素材或技能的实际内容

选择不同的创作阶段或章节时，DeepWrite 会切换对应的智能体和上下文。浏览素材与技能不会打断当前文稿，章节也可以通过独立标签快速切换。

![智能体协作写作与正文编辑](./docs/images/agent-manuscript.png)

### 让专业智能体参与写作流程

短篇创作提供多种职责明确的智能体：

- 人物智能体：设计人物、关系、动机与人物弧光
- 剧情智能体：规划主线、导语钩子、冲突、转折与结局
- 大纲智能体：将人物和剧情整理为可执行的分节大纲
- 正文专家：统筹正文结构、审阅成稿并完成润色修改
- 分节写手：围绕当前章节写作，保持情节、人物与文风连续

每个智能体都可以配置系统提示词、欢迎快捷指令和模型。短篇与剧本智能体还可以配置资料读取范围；长篇各阶段共享设定、剧情、正文与连续性账本，并可分别控制可读取的素材和技能类型。主智能体也可以带领子智能体团队协作。

### 审阅后再写入文稿

智能体不会直接覆盖你的文本。每次写入都会先生成差异对比，你可以查看新增和删除内容，再决定接受或拒绝。只有接受后的修改才会保存到本地；如果文稿已被其他操作更新，DeepWrite 会保留较新的版本，避免静默覆盖。

![智能体修改 Diff 与接受或拒绝操作](./docs/images/edit-diff.png)

### 管理本地作品与知识库

DeepWrite 支持：

- 新建或打开本地作品
- 管理人物、剧情、大纲与多个正文小节
- 创建素材库和技能库，并维护 Markdown 条目
- 将指定素材库、技能库或资料分组绑定到作品
- 导入旧版书籍 ZIP，并转换为当前文件夹结构
- 自动恢复未保存草稿和最近的智能体会话

数据使用开放的本地文件格式保存，不会被锁定在应用内部。

### 使用自己的模型

你可以在模型配置中添加自己的 API 服务。当前支持：

- OpenAI Completions
- OpenAI Responses
- Anthropic Messages
- Google Generative AI

模型密钥不会暴露给页面渲染层。不同模型可以设置默认思考等级，也可以在对话过程中按任务切换。

## 安装与使用

### 使用安装包

前往 [GitHub Releases](https://github.com/swjybky/deepwrite/releases)，下载与你的系统和处理器匹配的测试安装包：

| 系统 | 安装包 |
| --- | --- |
| Windows x64 | `DeepWrite-<version>-win-x64-test.exe` |
| Windows ARM64 | `DeepWrite-<version>-win-arm64-test.exe` |
| macOS Apple Silicon | `DeepWrite-<version>-mac-arm64-test.dmg` |
| macOS Intel | `DeepWrite-<version>-mac-x64-test.dmg` |
| Linux x64 | `DeepWrite-<version>-linux-x64-test.AppImage` / `.deb` |
| Linux ARM64 | `DeepWrite-<version>-linux-arm64-test.AppImage` / `.deb` |
| Arch Linux / CachyOS x64 | `DeepWrite-<version>-linux-x64-test.pkg.tar.xz` |
| Arch Linux / CachyOS ARM64 | `DeepWrite-<version>-linux-aarch64-test.pkg.tar.xz` |

Windows 用户运行 `.exe` 并按安装向导完成安装。

Arch Linux、CachyOS 等 Arch 系发行版可用 `sudo pacman -U ./DeepWrite-<version>-linux-x64-test.pkg.tar.xz` 安装本地包。应用自带 Electron；保存模型密钥需要已启动并解锁的系统密钥服务（例如 GNOME Keyring 或 KWallet），应用会自动选择后端。

macOS 用户打开 `.dmg`，将 DeepWrite 拖入“应用程序”文件夹。当前测试包使用 ad-hoc 签名且未经过 Apple 公证；通过浏览器、微信等渠道下载后，macOS 可能显示安全提醒。请先确认文件来源可信，再右键应用选择“打开”，或前往“系统设置 → 隐私与安全性”允许打开。

首次启动后，建议按以下顺序完成配置：

1. 选择本地工作目录。
2. 在“模型配置”中添加 API 服务并测试连接。
3. 新建作品，或打开已有的 DeepWrite 项目文件夹。
4. 按需创建并绑定素材库、技能库。

### 从源码运行

环境要求：

- Node.js 24 或更高版本
- pnpm 11 或更高版本
- Windows x64、Linux x64，或 macOS Apple Silicon / Intel

```bash
git clone https://github.com/swjybky/deepwrite.git
cd deepwrite
pnpm install
pnpm dev
```

常用开发命令：

```bash
pnpm dev       # 启动桌面端开发环境
pnpm build     # 构建生产版本
pnpm verify    # 运行格式、类型、边界、测试与构建校验
```

### macOS Codex 的桌面启动限制

开发、预览、桌面冒烟、视觉探针和本机安装包运行验证会先检测 Codex 的 macOS Seatbelt 沙盒。处于该沙盒时，入口以 `DEEPWRITE_ELECTRON_SANDBOX` 提前退出并给出处理提示，避免 Electron 在访问窗口服务或 LaunchServices 时中止并弹出系统崩溃报告。

需要运行桌面窗口时，从系统终端执行 `pnpm dev`、`pnpm --filter @deepwrite/desktop preview` 或相应验收命令；Codex 中则为具体启动命令申请沙盒外执行。常规单元测试、构建、Electron 安装文件检查和跨平台静态安装包检查仍可在沙盒内运行。`--no-sandbox` 只控制 Chromium 的内部沙盒，无法解除 Codex 的系统限制。

## 构建测试安装包

测试安装包必须在对应平台构建，并从仓库根目录运行：

```bash
pnpm pack:test             # 当前主机支持的全部测试包
pnpm pack:test:arch        # Arch Linux / CachyOS x64
pnpm pack:test:linux       # Linux x64：AppImage、deb 和 Arch 包
pnpm pack:test:linux:arm64 # Linux ARM64：AppImage、deb 和 Arch 包
pnpm pack:test:win         # Windows x64
pnpm pack:test:win:arm64   # Windows ARM64
pnpm pack:test:mac:arm64   # macOS Apple Silicon
pnpm pack:test:mac:x64     # macOS Intel
pnpm pack:test:mac         # 两种 macOS 架构
```

产物保存在 `apps/desktop/release/`。打包流程会先执行完整校验和生产构建，再生成并验证安装包。

### 标签自动发布

提交并推送工作流及相关改动后，先将根目录和 `apps/desktop/package.json` 的版本同步为目标版本，再推送对应的 `v主版本.次版本.补丁版本` 标签（例如两个版本均为 `1.6.6` 时推送 `v1.6.6`）。

`Build and publish tagged release` 工作流在各自的原生 runner 上构建并验收 Windows x64 / ARM64、macOS ARM64 / Intel 和 Linux x64 / ARM64（AppImage、deb、Arch）安装包。全部任务通过后，工作流校验文件大小和 SHA-512，合并两种 macOS 架构的更新清单并写入 ARM64 更新清单，再将资产上传到草稿并自动公开 GitHub Release。失败会保留构建产物或本轮草稿，重新运行该工作流可续传；已有公开 Release 不会被覆盖。

如果标签已经存在但没有触发记录，在 Actions 中打开该工作流，点击 `Run workflow`，选择 `main` 并填入已有标签（如 `v1.6.6`）。补跑仍从该标签检出源码并核对版本，不需要删除或移动标签。后续有失败记录时使用原运行的 `Re-run jobs`，以继续本轮草稿上传。

CI 使用免费标准 runner：x64 与 ARM64 的 Linux 和 Windows、Intel Mac 使用 4 个测试 worker，Mac ARM 使用 3 个；Node 堆上限分别为 6 GiB 和 4 GiB。pnpm、Electron 和打包工具下载使用按系统、架构与依赖锁定文件隔离的缓存。桌面构建与冒烟先于完整测试，任一平台失败后取消本轮其余任务；正式打包仍保留完整校验和包内首次启动、重新打开验收。

构建产物在 Actions 中保留 14 天。发布使用仓库提供的 `GITHUB_TOKEN`，无需额外发布密钥；当前包仍采用既有的 Windows 未签名、macOS ad-hoc 签名方案。应用内的 `update.json` 继续按既有发布清单流程维护。

## 项目结构

```text
deepwrite/
├── apps/desktop/              # Electron 桌面客户端
├── packages/contracts/        # 进程间命令与事件契约
├── packages/pi-runtime-adapter/
│                              # Agent Runtime 适配层
├── packages/shared/           # 共享类型与工具
├── tools/                     # 校验、运行与打包脚本
└── docs/images/               # README 与项目文档图片
```

DeepWrite 采用 Electron 多进程架构：Renderer 负责界面，Main 管理窗口与安全 IPC，Core Utility 负责本地项目读写，Agent Utility 负责模型和智能体运行，Tool Utility 为受控工具执行提供边界。

## 许可证

DeepWrite 基于 [Apache License 2.0](./LICENSE) 开源。
