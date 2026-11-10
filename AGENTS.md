# DeepWrite 仓库约定

只写改代码时必须守住的边界。前端界面、颜色、布局和控件规范见 [DESIGN.md](DESIGN.md)，改动 Renderer 界面时再读。

## 酒馆分支仅限本地

- `tavern` 分支禁止推送到任何远程（含改名推送），也不得经合并、拣选或远程 PR 间接上传其中的酒馆预设代码。
- 推送前先核对当前分支与待推送提交；涉及 `tavern` 或其代码时停止。

## 项目布局

pnpm workspace，`apps/desktop/` 是唯一桌面客户端；依赖版本由 `pnpm-workspace.yaml` 的 catalog 管理。新能力放进现有分层，不另建平行应用、协议或打包入口。

| 位置 | 职责 |
| --- | --- |
| `apps/desktop/src/main/` | Electron 窗口、配置与密钥、安全 IPC、Utility 监管 |
| `apps/desktop/src/preload/` | `window.deepwrite` 专用 API 与双向校验 |
| `apps/desktop/src/utilities/` | Core 本地存储、Agent 运行、Tool 受控执行 |
| `apps/desktop/src/renderer/` | Vue 工作台、界面状态与会话编排 |
| `apps/desktop/src/extras/` | Main 注册的可选能力（含扩展智能体服务 `extras/agents/`），界面在 Renderer `extras/` |
| `packages/contracts/` | 命令、事件、领域模型的 Zod 契约 |
| `packages/pi-runtime-adapter/` | Pi 运行时与受控工具；`kernel/` 共享内核，`extras/` 扩展智能体定义 |
| `packages/shared/` | 无业务语义的共用工具 |
| `tools/` | 边界检查、运行时与打包编排 |

## 进程与协议边界

- **IPC 与凭据：**Renderer 只从 `@deepwrite/contracts/renderer` 取契约运行时值，不引入 `electron`、`node:`、Pi SDK 或 `@deepwrite/pi-runtime-adapter`。Provider 凭据和模型密钥只留在 Main / Agent。跨进程只走 contracts 的 Envelope 命令与事件，不开任意 IPC 通道。
- **契约变更顺序：**先改 `packages/contracts` 的类型与 schema，再接 Preload、Main 路由、对应 Utility；Renderer 要用的运行时值从 `packages/contracts/src/renderer.ts` 导出。
- **本地写入：**Core Utility 是作品与路径注册表的唯一写入者，写入保持原子性。作品是文件夹，清单 `deepwrite.json`，正文与设定为 UTF-8 Markdown；短篇、剧本、素材库、技能库由 `folder-catalog-store` 管理，长篇由 `long-project-store` / `long-workspace-service` 管理。Agent 读作品走 Main 授权的 Core 只读桥；改文稿先出 proposal 差异，用户接受后由 Core 落盘并处理版本冲突。
- **智能体分域：**所有智能体共用 `pi-runtime-adapter/src/kernel/`。创作空间与资料库经 `session.prompt`（`workspace-run-plan.ts`）；“更多功能”的聊天与分析经 `extrasAgent.run`，不得往 `session.prompt` 载荷或 `WorkspaceRuntimeContext` 加扩展字段。
- **扩展智能体：**Renderer 只传 `profileId`，档案、作品、模型与用量快照由 Main（`ExtrasAgentConfigStore`、`resolveExtrasTask`）权威解析；预算用 `assertExtrasAgentBudget` 在 Renderer 预检、Main 与 Agent 复核。系统提示词 = 档案提示词 + 不可编辑的 `【名称运行边界】`；工具只由开发者在定义里从 `extras/tools/` 组合。分析页用 `startExtrasAgentTask`，聊天复用 `useAgentConversation`。新增步骤：contracts（ID、档案与输入 schema、结果、用量映射）→ `profile-catalogs.ts` →（需要时）`task-resolver.ts` → `extras/agents/` 定义与 Faux 响应 → `resolveExtrasAgent` 注册 → 页面。
- **外部控制（MCP）：**实现在 `extras/external-control/` 与 contracts `external-control/`，设计见 `docs/外部智能体控制接口设计.md`。直接写入不走提案，但必须带版本校验、不得 `force`；同一作品被运行占用时返回 `external.busy`；删除必须可恢复。工具经 `tool-routes.ts` 白名单开放；设置页管理命令（撤销授权、清空回收站、安装 Skill）不得开放为 MCP 工具。改工具或错误码时同步 `extras/external-control/skill/SKILL.md`。
- **打包入口：**Main `src/main/index.ts`、`core-entry` / `agent-entry` / `tool-entry`、Preload、Renderer。改进程入口、Utility 或安装包 `files` 时同步检查 `electron.vite.config.ts`、supervisor 启动路径、冒烟脚本和 `pnpm lint:boundary`。

## 桌面启动（macOS 沙盒）

- 开发、预览、冒烟、视觉探针入口在拉起 Electron 前必须调用 `tools/electron-launch-environment.mjs` 的 `assertElectronLaunchAllowed()`。
- 收到 `DEEPWRITE_ELECTRON_SANDBOX` 时不在沙盒内重试或绕过（不直接跑 `pnpm exec electron`、`electron-vite dev/preview`）；申请沙盒外执行或请用户在系统终端启动。受拦截的桌面验收不得报告为通过。

## 代码质量与验证

- 格式与静态检查以 `.editorconfig`、`prettier.config.mjs`、`eslint.config.js` 为准，只格式化改动涉及的文件。按改动运行 `pnpm format:check` / `typecheck` / `lint` / `test` / `build`，完整为 `pnpm verify`。
- 新文件与实质修改模块的建议行数上限（评审提示，非硬门槛）：Vue 页面 400、Vue 组件 300、store / composable / service / handler 300、contracts 350、Main / Utility 入口与 Preload 200、shared 与 tools 脚本 250、独立 CSS 300、测试 500。超出时按真实职责拆分，不为凑行数压缩代码或造转发层。
- 测试验证可观察行为与失败路径；跨进程、安装包改动需要集成或桌面验证，不能以类型检查或构建代替。
- 磁盘、事务、SQLite、真实文件系统测试归入 `vitest.config.ts` 的 `disk-integration` 阶段；竞态用确定性同步点（如 `withProjectTransactionLock` 回调）而非运行速度；临时目录用 `fs.rm` 的有界重试。日常 CI 同时跑 Linux 与 Windows。

## 敏感信息

- 测试、夹具、快照、Mock 与日志不得含真实接口地址、IP、生产域名或可用凭据；地址用 `example.test`，凭据用明显无效的占位值。发现泄露先移除并轮换。
- 发布配置来自 Actions Secret `DEEPWRITE_RELEASE_ENV`（由 `tools/release-environment.mjs` 恢复 `.env`），缺必填项须在打包前失败；`MAIN_VITE_OSS_*` 不得进入发布环境，OSS 凭据只留在 API 服务端。

## 易重犯的问题

- **单次输出会随书变长的智能体调用：**按模型配置动态定额（`decompositionCallOutputTokens` 及派生上限），列表型成品用 `more` 分批暂存；`stopReason: "length"` 不是正常结束，由 `createSubagentReplyGuard` 处理，不原样重发。
- **同一份数据的读写上限：**写入、读取与事务恢复共用同一大小上限（参考 `job-state-store.ts`、`completion-ledger.ts`）。
- **跨进程错误：**界面用 `getErrorPayload` 读结构化错误，按 `ErrorPayload.code` 分支，不 `String(cause)`，不靠错误文字判断。
- **即时操作闪烁：**页面级 `saving` 不得波及无关控件；开关类操作乐观更新、受控显示。细则见 [design/feedback.md](design/feedback.md)。
