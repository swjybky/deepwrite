# DeepWrite 仓库约定

本文件是开发入口：行为准则、开发阶段与项目边界。其余文档按需加载。

## 开发阶段

按改动大小自行判断做哪些阶段。简单改动直接改，做最小验证，在回复里说明即可。

- **理解：**看相关代码和 `docs/` 里的设计；大功能先对齐方案或写设计稿。
- **预防：**涉及 [ERROR.md](ERROR.md)“按改动区域预读”中的区域时，先读对应条目。
- **实现：**守住下方边界；改界面时读 [DESIGN.md](DESIGN.md)。
- **验证：**见 [TEST.md](TEST.md)；样式改动必须截图比对，并在最终回复前把前后截图发到对话里给用户看，只存进 `test/` 不算完成；值得留档的写进 `test/`。
- **排错：**按 ERROR.md“按症状查找”加载条目；反复出现的错误沉淀为新条目。
- **提交与发布：**用 `git-commit`、`windows-macos-test-package`、`package-patch-release` skill。

这些文档都会进入上下文：只写结论和做法，过时即删。

## 启动环境

“启动开发环境”和“启动测试环境”都指在仓库根目录运行 `pnpm dev`。判断能否复用已启动的开发版时，见 [TEST.md](TEST.md) 的“开发环境：复用或重启”。

## 行为准则

- **先想清楚：**说明影响实现的假设与取舍；有多种理解时列出差异，关键问题先问；有更简单的方案就提出。
- **简单优先：**只写解决当前问题的必要代码，不加未要求的功能、配置、一次性抽象，也不处理不可能发生的错误。
- **精准修改：**每行改动都对应当前请求，遵循现有风格，不顺手改相邻代码、注释或格式。删除本次改动造成的无用代码；原有的无用代码只指出，不删。
- **目标驱动：**先定可验证的成功标准，验证通过才算完成；受阻时说明未完成项，不把未验证的结果报告为成功。

## 酒馆分支仅限本地

`tavern` 分支及其酒馆预设代码不得以任何方式上传远程，包括推送、改名推送、合并、拣选和 PR。推送前核对分支与提交，一旦涉及就停止。

## 项目布局

pnpm workspace，依赖版本由 `pnpm-workspace.yaml` 的 catalog 管理。新能力放进现有分层，不另建平行的应用、协议或打包入口。

| 位置（`apps/desktop/src/` 下） | 职责 |
| --- | --- |
| `main/` | 窗口、配置与密钥、安全 IPC、Utility 监管 |
| `preload/` | `window.deepwrite` API 与双向校验 |
| `utilities/` | Core 存储、Agent 运行、Tool 受控执行 |
| `renderer/` | Vue 工作台、界面状态与会话编排 |
| `extras/` | Main 注册的可选能力与扩展智能体（`extras/agents/`），界面在 `renderer/src/extras/` |

`packages/` 下：`contracts/` 放命令、事件与领域模型的 Zod 契约；`pi-runtime-adapter/` 放 Pi 运行时与受控工具（`kernel/` 是共享内核，`extras/` 是扩展智能体定义）；`shared/` 放无业务语义的工具。`tools/` 负责边界检查、运行时与打包编排。

## 进程与协议边界

- **IPC：**跨进程只走 contracts 的 Envelope 命令与事件。Renderer 只从 `@deepwrite/contracts/renderer` 取运行时值，不引入 `electron`、`node:`、Pi SDK 或 `pi-runtime-adapter`。凭据和模型密钥只留在 Main / Agent。
- **改契约：**按 contracts 类型与 schema → Preload → Main 路由 → Utility 的顺序改；Renderer 要用的值从 `contracts/src/renderer.ts` 导出。
- **写入：**Core Utility 是作品与路径注册表的唯一写入者，写入保持原子性。作品是文件夹：清单 `deepwrite.json`，内容为 UTF-8 Markdown。短篇、剧本、素材库、技能库由 `folder-catalog-store` 管理，长篇由 `long-project-store` / `long-workspace-service` 管理。Agent 经 Main 授权的 Core 只读桥读作品；改文稿先出 proposal，用户接受后由 Core 落盘并处理版本冲突。
- **智能体：**所有智能体共用 `pi-runtime-adapter/src/kernel/`。创作空间与资料库走 `session.prompt`；“更多功能”走 `extrasAgent.run`，不往 `session.prompt` 或 `WorkspaceRuntimeContext` 加扩展字段。
- **扩展智能体：**Renderer 只传 `profileId`，其余由 Main（`resolveExtrasTask`）权威解析。预算用 `assertExtrasAgentBudget` 做三端校验。系统提示词末尾附不可编辑的 `【名称运行边界】`，工具只由开发者在定义里从 `extras/tools/` 组合。新增顺序：contracts → `profile-catalogs.ts` →（需要时）`task-resolver.ts` → `extras/agents/` 定义与 Faux 响应 → `resolveExtrasAgent` 注册 → 页面（分析页用 `startExtrasAgentTask`，聊天用 `useAgentConversation`）。
- **外部控制（MCP）：**设计见 `docs/外部智能体控制接口设计.md`。写入要带版本校验、不 `force`；作品被占用时返回 `external.busy`；删除必须可恢复。工具经 `tool-routes.ts` 白名单开放，设置页的管理命令不开放。改工具或错误码时同步 `extras/external-control/skill/SKILL.md`。
- **打包入口：**改 Main、`core` / `agent` / `tool-entry`、Preload、Renderer 入口或安装包 `files` 时，同步检查 `electron.vite.config.ts`、supervisor 启动路径和冒烟脚本，并跑 `pnpm lint:boundary`。

## 代码质量

- 格式以 `.editorconfig`、`prettier.config.mjs`、`eslint.config.js` 为准，只格式化改动的文件。
- 不设固定行数上限。文件明显承担多项职责时（源码约 600 行起可作提醒）再按职责拆分，不为凑行数造转发层。测试里的硬性预算见 [error/budget-exceeded.md](error/budget-exceeded.md)。
- 默认不写注释，只写代码表达不了的“为什么”（非显而易见的约束、平台差异、对外部缺陷的规避），一两句为限。不写复述代码的注释、改动经过、无归属的 TODO，也不写大段文件头或 JSDoc。代码改了，就同步更新或删掉失效的注释。
- 拉起 Electron 前先调用 `tools/electron-launch-environment.mjs` 的 `assertElectronLaunchAllowed()`。遇 `DEEPWRITE_ELECTRON_SANDBOX` 时不在沙盒内重试或绕过；受拦截的桌面验收不报告为通过。

## 敏感信息

- 测试、夹具、快照、Mock 和日志不得含真实地址、IP、生产域名或可用凭据：地址用 `example.test`，凭据用无效的占位值。发现泄露先移除，再轮换凭据。
- 发布配置来自 Actions Secret `DEEPWRITE_RELEASE_ENV`，由 `tools/release-environment.mjs` 恢复为 `.env`；缺必填项必须在打包前失败。`MAIN_VITE_OSS_*` 不得进入发布环境，OSS 凭据只留在 API 服务端。
