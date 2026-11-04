# DeepWrite 仓库约定

按任务读取相关代码与文档；以下是新增或修改代码时需要守住的项目边界。

## 基础能力介绍

DeepWrite 的基础核心能力是创作空间、素材库、技能库和设置页面；它们共同构成日常写作与管理的主流程。

| 能力 | 作用 |
| --- | --- |
| 创作空间 | 管理短篇、剧本和长篇作品，围绕阶段、章节与正文开展编辑和智能体协作。 |
| 素材库 | 保存可复用的素材条目，并按作品需要关联和读取。 |
| 技能库 | 保存可复用的写作方法与技能条目，供作品和智能体按需使用。 |
| 设置页面 | 管理模型、智能体、正文文本、外观等基础配置。 |

- **支撑机制：**基础能力共用智能体机制（模型与提示词配置、作品上下文、素材与技能读取、受控工具和修改提案）及文本机制（本地 Markdown、编辑与预览、正文格式、差异审阅和版本安全保存）。修改这些机制时，应检查其对四项基础能力的影响。
- **扩展能力：**侧边栏“更多功能”中的聊天、修改分析、短篇/长篇拆书、文风比对、同步与备份等建立在基础能力之上；扩展功能复用既有的智能体、文本、协议和存储机制，不另建平行实现。其中需要智能体的能力统一走下文的扩展智能体服务。

## 项目布局与职责

DeepWrite 是 pnpm workspace，`apps/desktop/` 是唯一桌面客户端。根目录 `package.json` 提供开发、检查和打包入口，依赖版本由 `pnpm-workspace.yaml` 的 catalog 管理。新增能力先放入现有分层，不另建平行应用、协议或打包入口。

| 位置 | 职责 |
| --- | --- |
| `apps/desktop/src/main/` | Electron 窗口、配置与密钥、安全 IPC、Utility 监管 |
| `apps/desktop/src/preload/` | `window.deepwrite` 专用 API 与请求、响应校验 |
| `apps/desktop/src/utilities/` | Core 本地存储、Agent 运行、Tool 受控执行 |
| `apps/desktop/src/renderer/` | Vue 工作台、界面状态与会话编排 |
| `apps/desktop/src/extras/` | 由 Main 注册的可选能力，含扩展智能体服务 `extras/agents/`；对应界面放在 Renderer 的 `extras/` |
| `apps/desktop/scripts/` | Electron 冒烟、安装包验证与构建钩子 |
| `packages/contracts/` | 命令、事件和领域模型的 Zod 契约 |
| `packages/pi-runtime-adapter/` | Pi 运行时、工具 schema 与受控工具适配；`kernel/` 为共享运行内核，`extras/` 为扩展智能体定义 |
| `packages/shared/` | 无业务语义的共用工具 |
| `tools/` | 边界检查、运行时与打包编排 |

## 进程、协议与写入边界

- **IPC 与凭据：**Renderer 只从 `@deepwrite/contracts/renderer` 引入契约运行时值；不得直接引入 `electron`、`node:`、Pi SDK 或 `@deepwrite/pi-runtime-adapter`。Provider 凭据和模型密钥只留在 Main / Agent。跨进程通信使用 `@deepwrite/contracts` 的 Envelope 命令与事件，不开放任意 IPC 通道。
- **契约变更：**新增命令、事件、清单字段或 Preload API 时，先更新 `packages/contracts` 的类型与 schema，再接通 Preload、Main 路由和相应 Utility；Renderer 所需的契约运行时值还要从 `packages/contracts/src/renderer.ts` 导出。Preload 只暴露经过双向校验的专用方法。
- **本地写入：**Core Utility 是本地项目与路径注册表的唯一写入者，写入须保持原子性。本地作品以文件夹存放，清单为 `deepwrite.json`，正文与设定为 UTF-8 Markdown；短篇、剧本、素材库和技能库由 `folder-catalog-store` 管理，长篇由 `long-project-store` / `long-workspace-service` 管理。Agent 读取作品须经 Main 授权的 Core 只读桥；修改文稿须先展示 proposal 差异，用户接受后才由 Core 落盘，并处理版本冲突。
- **外部控制接口：**外部智能体经 MCP 操作运行中的软件，实现在 `extras/external-control/` 和 contracts 的 `external-control/`，设计见 `docs/外部智能体控制接口设计.md`。外部直接操作是“修改文稿须先展示 proposal”的例外：不走提案和审批，但必须带版本校验、不得使用 `force`，基础操作与发送交接经短队列串行；不同作品智能体可并行，同一作品或共享可写资源被运行占用时返回 `external.busy`，团队全局设置与恢复仍保守互斥，写后广播 `externalControl.resource_changed`。删除必须可恢复：小节和条目先存回收区，作品和库只移出列表。工具经 `tool-routes.ts` 白名单开放，结果用严格 schema 约束；Core 专用命令要加入 `main/index.ts` 的内联拦截。外部运行内置智能体由 Renderer 的 `extras/external-control/useExternalControlBridge.ts` 走和发送按钮相同的入口，必须用 `overrideNextApprovalMode` 按次自动审批，且要求“跨阶段操作自动审批”已打开；发往 contextBridge 的数据先转成纯对象。设置页的管理命令（撤销授权、清空回收站、安装 Skill）只从窗口进入，不得开放成 MCP 工具；Skill 正文在 `extras/external-control/skill/SKILL.md`，改工具或错误码时同步。
- **界面组织：**`WorkspaceShell.vue` 是工作台壳，默认三栏写作面留在入口，其他领域界面按现有 `lazyAppComponents` 按需加载。界面状态放 `stores/`，跨组件流程放 `composables/`，领域页面放 `features/` 或 `extras/`；业务写入留在 coordinator / Utility handler。可选能力沿用 Main `extras/`、Renderer `extras/` 和同一套 contracts。
- **智能体运行分域：**所有智能体共用 `pi-runtime-adapter/src/kernel/` 的运行内核（模型接入、重试、超时、工具流、用量事件、中止）。创作空间和资料库经 `session.prompt` 进入创作域（`workspace-run-plan.ts`）；“更多功能”的智能体（聊天与各类分析）经 `extrasAgent.run` 进入扩展域，不得再向 `session.prompt` 载荷或 `WorkspaceRuntimeContext` 添加扩展功能字段。
- **扩展智能体服务：**
  - **协议：**contracts 的 `extras-agent/` 定义智能体 ID、档案、任务输入、结果和命令。Renderer 只传 `profileId`，档案由 Main 的 `ExtrasAgentConfigStore`（`config/extras-agents/<agentId>.json`）权威解析，聊天所需的作品、模型和用量快照也只由 Main 的 `resolveExtrasTask` 读取；预算经 `assertExtrasAgentBudget` 在 Renderer 预检、Main 与 Agent 复核。
  - **两种交互：**分析类是一次性任务（`ExtrasTaskAgentDefinition`），每次运行由任务生成用户消息；聊天是对话（`ExtrasConversationAgentDefinition`，ID 见 `EXTRAS_CONVERSATION_AGENT_IDS`），运行请求必须携带 `conversation` 轮次（消息、历史、附件），Agent Utility 按 `conversationKey` 缓存对话。
  - **定义：**每个智能体在 `pi-runtime-adapter/src/extras/agents/` 有一份定义。系统提示词统一为“档案提示词 + 不可编辑的 `【名称运行边界】`”；工具只能由开发者在定义里从 `extras/tools/` 组合，不向用户开放。分析结果经结果工具或 `finalOutput` 统一发出 `extras_agent.output_updated`。
  - **界面：**分析页面用 `extras/agent-runtime/startExtrasAgentTask` 运行任务，不在页面里重复会话、事件过滤、停止与销毁逻辑；聊天复用 `useAgentConversation`，由 `sendAssistantMessage(task)` 经 `send-transport.ts` 发往扩展域。
  - **新增步骤：**依次补 contracts 的 ID、档案与输入 schema、结果类型和用量模块映射，`profile-catalogs.ts` 的内置档案（需要 Main 权威数据时再补 `task-resolver.ts`），`extras/agents/` 的定义与 Faux 响应，`resolveExtrasAgent` 注册，最后接页面。
- **进程与打包：**打包入口包括 Main `src/main/index.ts`、`core-entry` / `agent-entry` / `tool-entry`、Preload 和 Renderer。改动进程入口、Utility 或安装包 `files` 时，同步检查 `apps/desktop/electron.vite.config.ts`、supervisor 启动路径、冒烟脚本和 `pnpm lint:boundary`；改变运行时依赖的打包方式时还要检查 before-build 钩子与安装包内运行。

## macOS Codex 下的桌面启动与验收

- macOS 的 Codex Seatbelt 沙盒拒绝 Electron 对 WindowServer 和 LaunchServices 的访问，进程可能在业务代码执行前以 `SIGABRT` 崩溃。隐藏窗口、`detached: true`、复制二进制到临时目录和 Electron 的 `--no-sandbox` 参数都不能解除这个外层限制。
- 开发、预览、桌面冒烟和视觉探针入口必须在创建临时工作区、启动服务或拉起 Electron 之前调用 `tools/electron-launch-environment.mjs` 的 `assertElectronLaunchAllowed()`。新增桌面启动脚本时沿用这个检测；纯校验工具只在真正需要原生运行时检查，不影响跨平台静态检查。
- 收到 `DEEPWRITE_ELECTRON_SANDBOX` 后，不在沙盒内重复启动或尝试用环境变量隐藏沙盒状态。桌面验收需为具体命令申请沙盒外执行，或由用户在系统终端启动；保留通常的项目沙盒设置。
- 不直接从沙盒运行 `pnpm exec electron`、`electron-vite dev/preview` 或 Electron 二进制绕过启动检测。静态检查、单元测试和构建可以继续在沙盒内完成，不能把受拦截的桌面验收报告为通过。

## 代码质量与验证

- `.editorconfig`、`prettier.config.mjs`、`eslint.config.js` 是格式与静态检查的统一来源。只格式化任务涉及的文件，不因功能修改带入无关的大面积格式变化。按改动运行相关检查；根目录可用 `pnpm format:check`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 和完整的 `pnpm verify`。
- 文件行数是评审提示，不是机械硬门槛。以下建议上限用于新文件及本次实质修改的模块；按格式化后的手写物理行计数，空行、注释和 Vue 的各区块均计入，生成代码与大型静态数据除外：

  | 文件 | 建议上限 |
  | --- | ---: |
  | Vue 页面或工作台壳 | 400 行 |
  | 可复用或局部 Vue 组件 | 300 行 |
  | store、composable、service、handler、Pi adapter | 300 行 |
  | contracts 类型与 schema | 350 行 |
  | Main / Utility 入口、Preload 白名单 | 200 行 |
  | `shared` 纯工具、构建配置与 `tools/` 脚本 | 250 行 |
  | 独立 CSS | 300 行 |
  | 测试文件 | 500 行 |

- 超出建议上限或出现职责混杂时，先去除重复，再按 UI、状态流程、协议、特权操作等真实职责拆分，保持明确接口和单向依赖。不要为了凑行数压缩代码或制造转发层；较长但内聚的模块可以保留，并在评审时说明原因。测试优先验证可观察行为与失败路径；跨进程、安装包等改动还需相应的集成或桌面验证，不能以类型检查或构建代替运行验证。

## 测试数据中的敏感信息

- 测试代码、夹具、快照、示例请求、Mock 数据和日志不得包含真实接口地址、服务器 IP、生产域名或可用凭据。示例地址使用 `example.test` 等保留测试域名，凭据使用明显无效的占位值；确需读取本地值时，只能在运行时从已被 Git 忽略的环境文件获取，不能把值写进快照或输出。
- 检查本次新增或修改的测试材料是否泄露信息；发现泄露时先移除明文，并轮换已经暴露的凭据。

## 前端反馈与布局

- 表单校验、操作错误、成功和普通提示使用不占布局空间的 toast、message 或 notification；无需用户处理的提示自动消失。临时错误或警告不得插入表单、弹窗和按钮之间，避免高度变化与按钮跳动。
- 只有必须由用户确认才能继续的风险操作使用模态确认。字段说明可作为稳定辅助文案，但不承载临时错误或警告。

## 前端视觉、主题与控件

- 新页面和弹窗沿用现有容器层级、间距、圆角与控件样式；拆书分析等复杂页面以设置页为参照。颜色优先使用 `--surface-main`、`--surface-raised`、`--surface-muted`、`--surface-hover`、`--surface-selected`、`--theme-line`、`--theme-line-soft`、`--text-primary`、`--text-secondary`、`--text-tertiary`、`--accent`、`--accent-soft`，避免给普通容器另设固定色板。
- 与“设置 → 外观”实时联动：主题模式、强调色、背景色、前景色、UI 字号和可读性设置变化后应即时生效。`Teleport` 弹层同样使用根节点主题变量；检查浅色、深色和自定义强调色下的对比度，以及紧凑窗口和允许的字号范围，避免固定高度导致裁切。
- 业务表单中的列表选择框复用 Renderer 的 `PopupSelect`，保持尺寸、焦点、禁用态和交互一致，不混用原生 `<select>`；弹窗中的菜单须高于弹窗且不被裁切。
- 保存、创建、确认等主操作使用现有中性深色实心按钮；红色危险按钮只用于删除持久数据或不可恢复的覆盖；只清空临时内容的操作（如重新开始一次分析）使用普通主按钮。

## 常见 Bug 注意

按“现象 → 根源 → 守则”记录已经出过、容易重犯的问题；新增条目沿用这个格式，并附上可复用的实现位置。

- **远端安装包构建成功，公共服务和云备份却缺少配置：**
  - **现象：**本地运行正常，GitHub 构建的安装包没有公共服务地址。
  - **根源：**仓库根目录 `.env` 被 Git 忽略，远端 checkout 不包含本机配置；Main 的 `MAIN_VITE_*` 需要在编译时读入。
  - **守则：**官方发布使用仓库 Actions Secret `DEEPWRITE_RELEASE_ENV`，由 `tools/release-environment.mjs` 校验并恢复 `.env`；缺失必填项时在打包前失败；云备份经 DeepwriteApi 中转，禁止把 MAIN_VITE_OSS_* 放入发布环境，OSS 凭据仅留在 API 服务端。禁止将真实值写入源码、夹具、日志或发布说明。
  - **验证：**发布时启用 `DEEPWRITE_REQUIRE_RELEASE_CONFIG=1`，包内冒烟清除宿主 `MAIN_VITE_*` 后检查公共服务及备份 API 配置，首次启动与重开都须通过；保留 `releaseConfig` 成功标记。参考 `smoke-release-config.ts`、`package-smoke-runner.mjs`。
- **本地检查通过，Windows 发版却在测试阶段失败：**
  - **现象：**迁移、拆书测试单独运行通过，全量运行却触及默认 5 秒超时，清理临时目录或已提交的事务目录又报 `ENOTEMPTY`；事务锁测试依赖大量写盘和轮询，耗时随机器负载波动。
  - **根源：**日常 CI 只覆盖 Linux，真实文件系统和 SQLite 测试又与普通测试争抢磁盘；竞态测试靠运行速度制造时序，发版时才暴露 Windows 差异。
  - **守则：**日常 `.github/workflows/verify.yml` 同时覆盖 Linux 和与发布一致的 Windows runner、Node、pnpm 及 worker 配置。迁移、事务、作品与资料库、真实文件系统拆书和 SQLite 集成测试统一归入 `vitest.config.ts` 的 `disk-integration` 阶段，单 worker、测试及清理默认各 30 秒；普通测试和规模测试分阶段运行。事务锁竞态用 `withProjectTransactionLock` 回调等确定性同步点触发，保留文件身份、所有者和持久内容断言；临时目录与事务目录用 `fs.rm` 的 `maxRetries`、`retryDelay` 有界重试可恢复的占用，持续失败仍上抛。拆书夹具统一使用 `fixture-cleanup.test-support.ts` 清理并等待所有清理结果，不跳过失败或靠无限重试发版。
  - **验证：**运行完整 `pnpm verify`，确认测试没有遗漏或重复；改动 Windows 文件语义时还须通过原生 Windows CI。参考 `storage-migration.test.ts`、`project-transaction.test.ts` 和 `project-transaction/lock.windows.test.ts`。
- **操作一次，整页闪烁：**
  - **现象：**智能体团队切换启用时，列表与编辑器里所有开关、按钮同时降到 50% 透明再恢复；同类型还会短暂出现两个“已启用”。
  - **根源：**把一次几十毫秒的请求提升成页面级 pending 标志（`agentTeamSaving`），再让每个控件都把它绑到 `disabled`，往返期间整页变灰又恢复。开关又靠原生 checkbox 自己翻转，显示值与数据脱节，失败时也不回滚。
  - **页面级状态：**`saving` / `loading` 只留给确需阻断的显式操作（保存、创建、安装、删除），且只影响触发它的按钮；不得借它改动无关控件的 `disabled`、透明度，也不得用 `v-if="loading"` 整块替换已有内容。
  - **即时操作：**开关、勾选这类可逆操作先乐观更新，再用 Main 返回的快照收敛，失败时提示并从权威数据恢复，不拉起页面级 `saving`；并发请求用序号丢弃过期回复。参考 `useAgentTeamCatalogCoordinator.setAgentTeamEnabled`。
  - **受控控件：**显示值只来自数据（`:checked="modelValue"`），变更事件只上报请求，随后把 DOM 对齐回数据。不要用 `preventDefault` 抢回状态，Vue 在微任务里的更新会被浏览器的取消激活覆盖。参考 `AgentTeamSwitch.vue`。
  - **共用规则：**像“每种类型只启用一个团队”这类业务规则，放 contracts 的纯函数（`withAgentTeamEnabled`），Main 落盘与 Renderer 预览共用，避免两侧漂移。
  - **验证：**闪烁不能靠肉眼、类型检查或源码断言确认。在 Browser 窗格用临时 harness（真实组件、真实 store 与 coordinator、带延迟的假 api），用 `setInterval` 或 `requestAnimationFrame` 逐帧采样关键控件的 `checked`、`opacity`、`disabled` 与布局高度；点击后应只有一次状态变化，没有中间态。harness 放在 scratchpad，用完删除。
- **一次输出超限，重试也一样失败：**
  - **现象：**整书拆解的名册员思考两分钟后结束，工具调用 0 次，报“子智能体没有生成可交接的摘要”；同一分片重派时用量一模一样，反复失败。
  - **根源：**名册分片固定 1000 个名字，且要求一次工具调用交出整片名册（数万 token 的 JSON），超出模型单次输出上限（思考与正文共用 `maxTokens`）。回复在思考中被截断（`stopReason: "length"`），子智能体生命周期却当作正常结束并误报原因；重派时输入不变，失败必然重演。
  - **输出定额：**凡是一次调用交出的内容会随书变长的单元，都按阶段模型的配置动态定额：`decompositionCallOutputTokens`（`maxTokens` 扣除思考档位份额后封顶），以及由它派生的 `decompositionBatchLimit`、`decompositionProseCharacters`，不写死条数。列表型成品（编年、主线分卷、伏笔线、设定条目）用 `more` 分批，由 Core 暂存在任务目录 `drafts/`，重试时从暂存处续交。名册只让模型输出编号决定（`registry-plan`），次数、章号、别名和合并由 Core 计算；跨分片合并先由程序完成，只把候选簇交给模型。
  - **截断处理：**`stopReason: "length"` 不是正常结束。子智能体由 `createSubagentReplyGuard` 提示“拆小批次”后继续，次数用尽时明确报“超过模型单次输出上限”；不要原样重发同一请求。
  - **验证：**用小 `maxTokens` 加高思考档位的模型配置跑 Core 流程测试（参考 `registry-flow.test.ts`），并用 Faux 截断回复覆盖子智能体（参考 `subagent-reply-guard.test.ts`），确认分片变小、分批暂存可续交、截断时报出真实原因。
- **全部单元完成，最后却报完成记录超限：**
  - **现象：**拆书进度达到 100%，收尾时报“完成记录超过大小限制”，随后又出现 `[object Object]`，继续任务也无法读取。
  - **根源：**`completion.json` 复制所有单元的输出引用，写入允许 32 MB，读取却只允许 1 MB；账本已提交后回读失败。Renderer 收尾检查又直接 `String(cause)`，丢失跨进程错误载荷中的消息。
  - **守则：**任务状态和完成日志的写入、读取及事务恢复共用大小上限；完成日志仅保存账本改变的单元引用，同时兼容旧版完整引用日志。界面使用 `getErrorPayload` 读取结构化错误。参考 `job-state-store.ts`、`completion-ledger.ts` 和 `useLongBookDecomposition.ts`。
  - **验证：**用 1910 个单元生成超过 1 MB 的旧完成日志，验证重启读取、完成保存和超限拒绝；模拟账本提交后、回执刷新前中断，确认继续只补齐收尾、所有单元仍已完成且账本只有一条。参考 `job-state-store.test.ts`、`completion-recovery.test.ts` 和 `process-recovery.test.ts`。
