# DeepWrite

[English](./README.md) · **中文** · [下载安装包](https://github.com/swjybky/deepwrite/releases)

> 面向创作者的本地优先 AI 写作智能体工作台，源码可用。

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

通过官方小站入口添加的模型请求会携带 `X-DeepWrite-Session-ID`：同一会话跨轮次、重试和工具续轮保持一致，新会话使用新标识，便于服务端保持来源与账号。免费模型和自定义接口不会自动添加此请求头，即使它们使用相同地址或 Provider 名称。

## 安装与使用

### 使用安装包

前往 [GitHub Releases](https://github.com/swjybky/deepwrite/releases)，下载与你的系统和处理器匹配的测试安装包：

| 系统 | 安装包 |
| --- | --- |
| Windows x64 | `DeepWrite-<version>-win-x64-test.exe` |
| macOS Apple Silicon | `DeepWrite-<version>-mac-arm64-test.dmg` |
| macOS Intel | `DeepWrite-<version>-mac-x64-test.dmg` |

Windows 用户运行 `.exe` 并按安装向导完成安装。

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
- Windows x64，或 macOS Apple Silicon / Intel

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
pnpm pack:test:linux       # Linux x64：AppImage、DEB、RPM、Arch
pnpm pack:test:win         # Windows x64
pnpm pack:test:mac:arm64   # macOS Apple Silicon
pnpm pack:test:mac:x64     # macOS Intel
pnpm pack:test:mac         # 两种 macOS 架构
```

产物保存在 `apps/desktop/release/`。打包流程会先执行完整校验和生产构建，再生成并验证安装包。

Linux 各格式统一使用 `pnpm pack:test:linux`。Ubuntu/Debian 构建机除桌面运行依赖外，还需安装 `rpm`、`rpm2cpio`、`libarchive-tools`、`zstd`；Arch 构建机需安装 `rpm-tools`、`libarchive`、`zstd`，工作流会自动准备相应工具。RPM 和 Arch 包包含 Electron 运行时，并声明 `libsecret` 依赖。

下载后，Fedora/RHEL 可执行 `sudo dnf install ./DeepWrite-<版本>-linux-x86_64-test.rpm`，Arch 可执行 `sudo pacman -U ./DeepWrite-<版本>-linux-x64-test.pkg.tar.zst`。这里生成可本地安装的 Arch 包，不会提交到 AUR。验收会检查架构、桌面入口、运行时文件，以及 RPM/Arch 包内 ASAR 是否与首次启动、重新打开验收所用应用一致。

### 推送标签后自动发布

仓库的 `Build and publish tagged release` 工作流在推送 `v*` 标签时自动运行：推送标签 → 构建并验收所有平台 → 上传到草稿 → 公开完整的 GitHub Release。标签必须采用 `v主版本.次版本.补丁版本` 格式，且与两个 package.json 的版本一致。普通分支推送和发布 Release 不触发打包。

1. 首次使用先将 `.github/workflows/release.yml` 和配套脚本推送到 `main`，标签指向的代码也须包含这些文件。
2. 将根目录和 `apps/desktop/package.json` 的 `version` 改成相同的目标版本，提交并推送。例如都为 `1.6.6` 时，对应标签为 `v1.6.6`。
3. 执行 `git tag v1.6.6` 和 `git push origin v1.6.6` 创建并推送标签，无需手动创建 Release。
4. 在 **Actions → Build and publish tagged release** 查看进度。所有平台通过后，工作流会将安装包、blockmap、更新清单和 `SHA256SUMS.txt` 上传至草稿，核对完整后自动公开 Release。

工作流使用 Windows x64、macOS Apple Silicon、macOS Intel 和 Linux x64 的原生 runner，产物包括 Windows EXE、两种 Mac 架构的 DMG / ZIP、Linux AppImage / DEB / RPM / Arch（`.pkg.tar.zst`）。各平台沿用 `pnpm pack:test:*` 完成格式、类型、lint、测试、构建及包内首次启动和重新打开验收；Mac 还会检查 DMG、ad-hoc 签名和 ZIP。发布前校验文件大小与 SHA-512，并合并两个架构的 `latest-mac.yml`。构建产物在 Actions 中保留 14 天。

只有发布任务通过仓库自动提供的 `GITHUB_TOKEN` 获得 `contents: write`，构建任务保持只读，无需另建个人访问令牌。仓库须允许运行 Actions 和这些工作流使用的 Action。Windows 包沿用未签名配置，macOS 沿用 ad-hoc 签名且不进行 Apple 公证。

失败时在原运行中选择 **Re-run failed jobs**，复用已成功的平台产物并继续本轮草稿上传。重试会跳过大小和 SHA-256 相同的附件；只清理本轮私有草稿中未完成的空附件后重传，不覆盖不同内容的同名文件、已有公开 Release 或其他运行的草稿。上传失败时草稿保持私有。若标签没有触发记录，可在工作流的 **Run workflow** 中选择 `main`，填入已有标签补跑，源码始终取自标签对应的提交。发布说明自动生成。GitHub 按语义版本选择 Latest，旧标签晚完成也不会顶替新版本。

若四个平台均通过、仅最后发布失败，可在 **Actions → Build and publish tagged release → Run workflow** 选择 `main`，填入原标签，并将 `reuse_run_id` 设为原运行编号。恢复前会核对源码提交、各平台验收结果和完整未过期的产物，再接续原运行的草稿。恢复使用所选工作流版本的发布工具，标签仍指向安装包源码，不重新构建安装包。

新构建会保留以实际检出的安装包源码提交命名的 `release-source-<commit>` 产物，因此从 `main` 手动构建旧标签也能恢复。旧版标签推送任务仍可凭匹配的标签与提交恢复；缺少来源记录的历史手动任务须重新构建一次，其触发分支提交无法证明安装包源码。已有来源记录与目标提交不符、冲突、为空或过期时会拒绝恢复。

应用内更新继续由根目录 `update.json` 控制。Release 公开且安装包全部上传成功后，再按既有发布清单流程更新它；工作流不会提前递增清单版本。

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

DeepWrite 以**源码可用**方式提供。新增且由其著作权人按 [PolyForm Perimeter License 1.0.1](./LICENSE) 提供的项目材料，适用该许可的竞争限制。

- **允许个人创作获利**：可以使用 DeepWrite 写付费小说、接稿、出版并获取稿费或版税。本软件许可证不要求你公开文稿或分享写作收入。
- **允许学习和自用修改**：可以阅读、研究源码，并为自己的写作需要修改软件。不提供竞争产品的企业内部使用也被允许。
- **竞争软件与服务须另行授权**：未经相关著作权人另行授权，不得利用受本许可约束的代码，向他人提供与 DeepWrite 竞争的软件、网站或服务，包括换名、换界面后作为竞争软件收费销售，或通过竞争性托管服务提供其写作功能。竞争产品即使免费提供，也受该限制。

以上为便于理解的说明，具体以 [LICENSE](./LICENSE) 中未修改的英文原文为准。该许可包含竞争限制，不符合 [OSI 开源定义](https://opensource.org/osd)，因此本项目对外表述为“源码可用”。

**历史授权与第三方材料**：已经按 Apache License 2.0 发布的代码和版本，仍保留既有授权。既有第三方贡献与依赖继续适用各自原有许可，除非相关著作权人另行同意变更。许可范围与历史贡献者署名见 [NOTICE](./NOTICE)，原 [Apache License 2.0](./LICENSES/Apache-2.0.txt) 文本予以保留。
