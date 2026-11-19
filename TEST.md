# DeepWrite 验证

本文件写验证思路与报告规范。每次验证的报告和产物放在 [test/](test/)，并在文末“验证记录”登记。报错时转 [ERROR.md](ERROR.md)。

## 原则

- 动手前把请求写成可观察的成功标准；完成后逐条核对，没核对的写进“未覆盖”，不报告为通过。
- 按影响面验证，默认不跑全量：先跑改动直接影响的部分，范围扩大才逐级加测。修正中只重跑失败项，收尾时通过一次即可。
- 测可观察的行为和失败路径：加校验先测无效输入；修缺陷先写能复现的失败测试；重构前后相关测试都要通过。
- 类型检查和构建不能代替跨进程、安装包、界面与真实模型的验证。被沙盒、缺密钥、缺设备拦下的记为“未验”，写明原因和需要谁来补。

## 验证分级

| 级别 | 何时 | 跑什么 |
| --- | --- | --- |
| L1 改动内 | 每次开发循环 | `pnpm vitest related --run <改动文件>`；`pnpm exec eslint <改动文件>`；`pnpm exec prettier --check <改动文件>` |
| L2 影响面 | 改类型、contracts、跨进程、界面、打包 | L1，再按下表加测 |
| L3 全量 | 仅用户明确要求 | `pnpm verify`；提交、打包、发版都不本地跑，交给 CI（Linux + Windows） |

全量包含单 worker 的 `disk-integration`，耗时长且占满 CPU，开发中不反复跑。工作区混有他人改动时，全量失败难以归因：以 L1 / L2 的结论为准，并说明情况。

## 按改动加测（L2）

| 改动 | 加测 |
| --- | --- |
| 类型、contracts schema | `pnpm typecheck`；schema 先测无效输入 |
| 磁盘、事务、SQLite、真实文件系统 | 测试登记到 `vitest.config.ts` 的 `disk-integration`；竞态用确定性同步点，不靠速度；临时目录用 `fs.rm` 有界重试 |
| 持久化 schema、双端同步模块 | 新旧数据双向读写测试；同步检查 deepwrite-app 镜像（[error/schema-compat.md](error/schema-compat.md)） |
| 智能体工具、提示词、子智能体 | Faux 响应测试；工具测试要经过 Pi 参数校验层，不能只直接调 `execute`；行为依赖模型时再用真实模型跑一次 |
| 样式、布局、组件外观 | 下节“视觉验证”，必做，截图须在对话中展示 |
| 即时操作、保存状态 | 逐帧采样（[design/feedback.md](design/feedback.md)） |
| IPC、Utility、进程入口 | `pnpm lint:boundary` + `pnpm build` + `pnpm smoke`（或 `smoke:conversation` / `smoke:shutdown`） |
| 安装包、`files`、打包脚本 | `windows-macos-test-package` skill；Windows 相关需实机或 CI |
| 路径、换行、进程占用 | Windows 分支测试（把 `node:path` mock 为 win32） |

## 开发环境：复用或重启

运行、MCP 与界面验证都在本仓库的开发版（`pnpm dev`）上做。动手前先花几秒判断能否复用，不在旧代码或断开的连接上测。

**顺序：**先跑无头验证（Vitest、`pnpm build`、`pnpm smoke`、探针），再按下表最多重启一次开发版，最后做 MCP、界面和截图。反过来做，每次构建或冒烟都会把开发版弄脏，只能反复重启。

**看现状（macOS）：**

```bash
for p in $(pgrep -f 'MacOS/Electron \.$'); do echo "dev pid=$p start=$(ps -o lstart= -p $p) cwd=$(lsof -a -p $p -d cwd -Fn | sed -n 's/^n//p')"; done
stat -f 'out/main %Sm' apps/desktop/out/main/index.js
grep -o '"pid":[0-9]*' ~/.deepwrite/control-dev/control.json || echo "control.json 缺失"
```

| 现状 | 做法 |
| --- | --- |
| 没有开发版 | `pnpm dev`。不要靠 MCP 的 `get_app_status` 拉起：它直接运行 `out/` 里上次构建的产物，没有 Vite，代码可能是旧的 |
| 开发版的 cwd 不是本仓库 `apps/desktop`（其他工作树、酒馆分支） | 所有检出共用 `desktop-dev` 数据目录的单实例锁和 `~/.deepwrite/control-dev`，新起的 `pnpm dev` 会直接退出并把焦点交给那个窗口。是本会话起的就结束后重起；别的会话或用户的不动，改用冒烟或探针（显式 `--user-data-dir`），MCP 运行验证请用户切换或记为未验 |
| 启动后改过 Main、Preload、Utility、`extras/` 的非界面代码或 `packages/` 运行时代码 | 重启。`pnpm dev` 不监听这些代码，只在启动时构建一次 |
| `out/main` 时间晚于开发版启动（期间跑过 `pnpm build` 或冒烟前的构建） | 重启。构建会清空重写 `out/`，开发版 Main 之后的懒加载与新拉起的 Utility 都从这里读，新旧代码混跑 |
| `control.json` 缺失，或 pid 不是当前开发版 | 重启。见 [error/mcp-dev-endpoint.md](error/mcp-dev-endpoint.md) |
| 只改了 Renderer（`.vue`、样式、Renderer 侧逻辑） | 复用，靠热更新 |
| 热更新后终端报错、界面状态异常，或改了 Pinia store、`WorkspaceShell.vue`、模块级单例 | 重启。开发窗口没有菜单，不能 Cmd+R 刷新；不在出错的热更新状态上继续测或下结论 |

**重启：**

- 本会话在终端里起的，在那个终端 Ctrl+C，等 Electron 保存后退出。
- 否则先用 `ps -o command= -p PID` 核对是本仓库的 `electron .` 再结束；`bridge-entry.js` 是 MCP 桥，不要动。先结束 Electron，再结束 electron-vite：顺序反了，Main 的输出管道已关闭，退出时会弹 `write EIO` 错误框并卡住，只能 `kill -9`。
- 在能读日志的终端里重新 `pnpm dev`（Claude Code 用 Terminal 面板或后台任务），记下新 Electron 的 pid。

**就绪：**`control.json` 的 pid 等于新 Electron 的 pid 后，调用 `get_app_status` 看到窗口就绪，再用 `list_works` 成功列出作品，才开始测。刚重启时目录未加载完，`get_agent_run` 等调用可能报“窗口无法打开目标”，等目录加载后重试一次即可，不计为功能失败。

## 运行验证（MCP 配合）

- 创作空间、素材库、技能库、智能体团队等运行场景，优先通过项目的 `deepwrite-dev` MCP 配合执行，减少重复的界面操作；按 [deepwrite-dev skill](.codex/skills/deepwrite-dev/SKILL.md) 操作，不连接安装版的 `deepwrite` 服务。
- 先按上节确认开发版就绪，再调用 `get_app_status` 确认连接；改过 `extras/external-control/` 的桥接代码时，MCP 客户端里的 `deepwrite-dev` 服务进程也要重连才会加载新代码。之后用 `list_works`、`list_libraries`、`list_agent_teams` 定位验证对象。写入前读取最新内容与 revision，使用副本或合成夹具。
- 按改动覆盖作品与库的读取、写入、重新读取，以及智能体普通运行或团队运行；团队场景显式指定 `mode: "team"`，检查返回的实际模式与运行结果。使用测试环境已配置的用户模型，允许消耗 token；先用小样本跑通，再扩大验证范围。
- MCP 发起运行后保存目标 id、runId 和 sessionId，跟踪到终态，核对实际内容、持久化结果及预期失败路径；仅收到 runId 不算通过。等待用户输入或运行失败时，按返回状态处理并在报告中说明。
- MCP 结果可作为功能运行证据；涉及界面交互、布局、反馈或安装包时，仍执行对应的界面、截图或安装包验证。报告注明 MCP、模型与运行模式，以及通过、失败和未覆盖项，不记录私有正文或密钥。

## 视觉验证（样式改动必做）

1. **启动测试环境：**在仓库根目录运行 `pnpm dev`（开发版独立数据目录）。需要可重复的隔离截图时，使用 Electron 探针（参照 `apps/desktop/scripts/analysis-page-probe.mjs`：Vite 起夹具页，临时 userData，`capturePage()` 输出 PNG）。不碰安装版和真实作品。
2. **截基线：**动手前先截。漏截时在 scratchpad 用 `git worktree add` 检出 HEAD 补截，不 stash 共享工作区。
3. **同条件截改后：**窗口尺寸、主题、字号、数据都与基线一致。至少截浅色和深色；涉及布局的加最小窗口 1000×680 和 UI 24px；有弹层或状态变化的加对应状态。
4. **比对：**逐对检查裁切、溢出、换行、对齐、颜色是否跟随主题；需要时在 scratchpad 生成并排图或差异图。每对写一句结论。
5. **存档：**截图存到 `test/日期-主题/`，命名 `before|after-light|dark-宽x高[-字号].png`，在报告中引用。
6. **展示给用户（完成门槛）：**最终回复前，把截图发到对话里让用户直接看到，只存文件或只贴路径不算完成。
   - Claude Code 用 `SendUserFile`（`display: "render"`），其他客户端用图片附件或 Markdown 图片 `![说明](绝对路径)`。
   - 每个检查条件（主题、尺寸、状态）都发：优先发并排对比图，没有就成对发前后图；每张配一句结论，比对发现的问题也要发出对应截图。
   - 发出后又改了样式，重新截图并重发最终版；最终回复里写明已展示哪几组、哪些未截及原因。
7. 测试环境起不来时，申请沙盒外执行或请用户在系统终端启动；仍不行就记为“未验”，在回复里明说没有截图，不用类型检查代替。

## 环境约束

- 拉起 Electron 前要经过 `assertElectronLaunchAllowed()`；遇 `DEEPWRITE_ELECTRON_SANDBOX` 见 [error/electron-sandbox.md](error/electron-sandbox.md)。
- 临时 harness 和探针页放 scratchpad，用完删除；需要留存的产物另存到 `test/`。
- **真实模型：**开发环境（`pnpm dev`，与安装版共用用户配置）里已配置的模型可以直接用来测试，用户已同意消耗其 token，不必为省用量跳过真实模型验证。不读取、不输出密钥，报告、产物和日志里都不写；长任务先用小样本跑通。
- 不在用户本机的真实作品上跑长任务或写入，改用副本或合成夹具。结束端口进程前先核对命令行（[error/process-kill.md](error/process-kill.md)）。
- **超时与噪声：**Vitest 不与构建、冒烟同时跑；负载下的单项超时先单独重跑该文件再判断。冒烟优先跑对应的 `--*-only` 子套件（参数见 `apps/desktop/scripts/electron-smoke.mjs`）；全量 `pnpm smoke` 的麦克风录音项在后台无权限时会超时，报告中单列为环境原因。

## 报告规范

- 功能开发、缺陷修复、样式改动和有产物的验证写报告；简单改动只在回复中说明验证了什么。
- 报告写在 `test/YYYY-MM-DD-主题.md`，产物放同名目录。同一任务的多轮验证追加到同一份报告。
- 报告不超过 40 行，分五节：目标与成功标准 / 环境 / 步骤与命令（注明级别）/ 结果（通过、失败、未验）/ 未覆盖与后续。
- 产物只放合成数据、采样结果和截图。不含私有正文、密钥、真实地址（地址用 `example.test`）；单个文件不超过 1 MB，不放 `*.test.*`。
- 写完在下表加一行，结论不超过 20 字；被新报告取代的旧行删掉。

## 验证记录

| 日期 | 主题 | 结论 | 报告 |
| --- | --- | --- | --- |
| 2026-11-18 | 剧本杀上下文移入管理 | 29 项与四组桌面截图通过 | [报告](test/2026-11-18-mystery-context.md) |
| 2026-11-18 | 长篇合并归档与账本确认 | 110 项与 Core 冒烟通过 | [报告](test/2026-11-18-long-continuity-archive.md) |
| 2026-11-18 | 技能广场已安装状态 | 71 项与桌面对比通过 | [报告](test/2026-11-18-skill-marketplace-installed.md) |
| 2026-11-18 | 五类书籍菜单与绑定统一 | 82 项测试与桌面截图通过 | [报告](test/2026-11-18-book-menu-bindings.md) |
| 2026-11-18 | 剧本杀结构与交互对齐 | 定向测试与桌面验收通过 | [报告](test/2026-11-18-mystery-structure-align.md) |
| 2026-11-18 | 学术写作工具栏移除下载按钮 | 四组截图与书籍导出验证通过 | [报告](test/2026-11-18-academic-toolbar-export.md) |
| 2026-11-18 | 冒烟不再删开发版 MCP 端点 | 单测与开发版旁冒烟通过 | [报告](test/2026-11-18-mcp-dev-endpoint.md) |
| 2026-11-18 | 编辑区工具栏层级与标题留白 | 98 项测试与五组视觉对比通过 | [报告](test/2026-11-18-editor-hierarchy.md) |
| 2026-11-18 | 学术写作与剧本杀合入 main | 全量与桌面验证通过 | [报告](test/2026-11-18-main-academic-mystery.md) |
| 2026-11-18 | main 模型工具参数迁移 | 全量验证通过 | [报告](test/2026-11-18-main-tool-enums.md) |
| 2026-11-18 | 模型工具布尔入参迁移 | 回归与四协议发包通过 | [报告](test/2026-11-18-model-tool-enums.md) |
| 2026-11-18 | 编辑工具全文覆盖模式 | 299 项与四协议发包校验通过 | [报告](test/2026-11-18-edit-overwrite-mode.md) |
| 2026-11-18 | 工作台热更新会话保存清理 | 定向回归与退出冒烟通过 | [报告](test/2026-11-18-conversation-cleanup.md) |
| 2026-11-18 | 四类创作工作台一致性 | 234项定向与39项桌面交互通过 | [报告](test/2026-11-18-writing-workspace-parity.md) |
| 2026-11-18 | 技能条目去分类与广场旧库兼容 | 定向测试与桌面验证通过 | [报告](test/2026-11-18-library-classification.md) |
| 2026-11-18 | 剧本杀统一树形与分栏 | 公共目录树与桌面交互通过 | [报告](test/2026-11-18-mystery-layout.md) |
| 2026-11-18 | 论证框架目录去设置按钮 | 23项及四组视觉通过 | [报告](test/2026-11-18-framework-icon.md) |
| 2026-11-18 | 编辑区样式统一 | 21项、四组截图与窄栏通过 | [报告](test/2026-11-18-editor-unify.md) |
| 2026-11-18 | 工作区审查问题修复 | 定向测试、冒烟与视觉通过 | [报告](test/2026-11-18-review-fixes.md) |
| 2026-11-17 | 学术写作与剧本杀双工作树合并 | 契约、单测、冒烟与视觉通过 | [报告](test/2026-11-17-merge-academic-mystery.md) |
| 2026-11-17 | 长篇剧情与章卡审阅去 JSON | 单测、构建与视觉对比通过 | [报告](test/2026-11-17-long-plot-proposal-review.md) |
| 2026-11-17 | 模型禁用 developer 角色 | 单测、构建与视觉对比通过 | [报告](test/2026-11-17-model-advanced-developer-role.md) |
| 2026-11-17 | 窗口自动记住大小 | 单测、桌面冒烟与视觉对比通过 | [报告](test/2026-11-17-window-auto-size.md) |
| 2026-11-16 | 新建作品下拉菜单定位 | 定位滚动与桌面验收通过 | [报告](test/2026-11-16-popup-select-position.md) |
| 2026-11-16 | 长篇分栏拖动性能 | 热点修复与桌面探针通过 | [报告](test/2026-11-16-long-pane-resize.md) |
| 2026-11-16 | 长篇会话截断定位 | 定位第三方上游链路 | [报告](test/2026-11-16-long-context-upstream.md) |
| 2026-11-17 | 学术写作与资料库共享 | 四期功能、预算与视觉通过 | [报告](test/2026-11-17-academic-writing-agent.md) |
| 2026-11-17 | 剧本杀创作空间与智能体 | 契约、MCP与桌面视觉通过 | [报告](test/2026-11-17-mystery-workspace.md) |
| 2026-11-15 | R2 更新源接入 | 全量校验通过 | [报告](test/2026-11-15-r2-updates.md) |
| 2026-11-15 | 技能团队广场合并 | Tab、兼容与视觉检查通过 | [报告](test/2026-11-15-marketplace-tabs.md) |
| 2026-11-15 | 更多功能默认入口 | 六项默认与配置交互通过 | [报告](test/2026-11-15-more-features.md) |
| 2026-11-14 | 反馈设备与版本信息 | 回归通过，跨平台待实测 | [报告](test/2026-11-14-feedback-device-info.md) |
| 2026-11-14 | 正文栏搜索高亮布局读取 | 回归通过，Win11待实测 | [报告](test/2026-11-14-editor-resize-search-highlight.md) |
| 2026-11-14 | 短篇剧本真实模型验收 | 修复后复测工具零错误 | [报告](test/2026-11-14-short-script-real-model.md) |
| 2026-10-02 | Agent 对话 Renderer 合成采样 | 基线数据，非前后对照 | [数据](test/2026-10-02-agent-conversation-performance/agent-conversation.json) |
| 2026-10-03 | 长篇文档切换 Core 读取 | 改动前后同夹具对照 | [数据](test/2026-10-03-long-document-switch/long-document-switch.json) |
| 2026-11-14 | 开发文档体系重构 | 链接与格式检查通过 | [报告](test/2026-11-14-agents-doc-system.md) |
| 2026-11-14 | 长篇智能体第 1 期 | 本地验证通过，真模待补 | [报告](test/2026-11-14-long-agent-phase-one.md) |
| 2026-11-14 | 长篇智能体第 2、3 期 | 全量、桌面与真模对照通过 | [报告](test/2026-11-14-long-agent-phase-two-three.md) |
| 2026-11-14 | 长篇账本与 MCP 恢复 | 回归与冒烟通过 | [报告](test/2026-11-14-long-ledger-mcp-recovery.md) |
| 2026-11-14 | 长篇 MCP 真实补测 | 核心走通，启动时序待修 | [报告](test/2026-11-14-long-mcp-real-validation.md) |
| 2026-11-14 | 长篇工具参数兼容 | 重放与团队完整轮零错误 | [报告](test/2026-11-14-long-tool-compatibility.md) |
| 2026-11-14 | 公告本地历史与时间轴 | 真实页面与截图验证通过 | [报告](test/2026-11-14-announcement-history.md) |
