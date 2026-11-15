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
| L3 全量 | 用户要求、大范围重构、依赖升级、发版前 | `pnpm verify`；平时交给 CI（Linux + Windows） |

全量包含单 worker 的 `disk-integration` 和 `scale`，耗时长且占满 CPU，开发中不反复跑。工作区混有他人改动时，全量失败难以归因：以 L1 / L2 的结论为准，并说明情况。

## 按改动加测（L2）

| 改动 | 加测 |
| --- | --- |
| 类型、contracts schema | `pnpm typecheck`；schema 先测无效输入 |
| 磁盘、事务、SQLite、真实文件系统 | 测试登记到 `vitest.config.ts` 的 `disk-integration`；竞态用确定性同步点，不靠速度；临时目录用 `fs.rm` 有界重试 |
| 持久化 schema、双端同步模块 | 新旧数据双向读写测试；同步检查 deepwrite-app 镜像（[error/schema-compat.md](error/schema-compat.md)） |
| 智能体工具、提示词、子智能体 | Faux 响应测试；工具测试要经过 Pi 参数校验层，不能只直接调 `execute`；行为依赖模型时再用真实模型跑一次 |
| 样式、布局、组件外观 | 下节“视觉验证”，必做 |
| 即时操作、保存状态 | 逐帧采样（[design/feedback.md](design/feedback.md)） |
| IPC、Utility、进程入口 | `pnpm lint:boundary` + `pnpm build` + `pnpm smoke`（或 `smoke:conversation` / `smoke:shutdown`） |
| 安装包、`files`、打包脚本 | `windows-macos-test-package` skill；Windows 相关需实机或 CI |
| 路径、换行、进程占用 | Windows 分支测试（把 `node:path` mock 为 win32） |

## 运行验证（MCP 配合）

- 创作空间、素材库、技能库、智能体团队等运行场景，优先通过项目的 `deepwrite-dev` MCP 配合执行，减少重复的界面操作；按 [deepwrite-dev skill](.codex/skills/deepwrite-dev/SKILL.md) 操作，不连接安装版的 `deepwrite` 服务。
- 先调用 `get_app_status` 确认开发环境连接与就绪状态，再用 `list_works`、`list_libraries`、`list_agent_teams` 定位验证对象。写入前读取最新内容与 revision，使用副本或合成夹具。
- 按改动覆盖作品与库的读取、写入、重新读取，以及智能体普通运行或团队运行；团队场景显式指定 `mode: "team"`，检查返回的实际模式与运行结果。使用测试环境已配置的用户模型，允许消耗 token；先用小样本跑通，再扩大验证范围。
- MCP 发起运行后保存目标 id、runId 和 sessionId，跟踪到终态，核对实际内容、持久化结果及预期失败路径；仅收到 runId 不算通过。等待用户输入或运行失败时，按返回状态处理并在报告中说明。
- MCP 结果可作为功能运行证据；涉及界面交互、布局、反馈或安装包时，仍执行对应的界面、截图或安装包验证。报告注明 MCP、模型与运行模式，以及通过、失败和未覆盖项，不记录私有正文或密钥。

## 视觉验证（样式改动必做）

1. **起测试环境：**优先用 Electron 探针（参照 `apps/desktop/scripts/analysis-page-probe.mjs`：vite 起夹具页，临时 userData，`capturePage()` 输出 PNG，可重复），也可用 `pnpm dev`（开发版独立数据目录）。不碰安装版和真实作品。
2. **截基线：**动手前先截。漏截时在 scratchpad 用 `git worktree add` 检出 HEAD 补截，不 stash 共享工作区。
3. **同条件截改后：**窗口尺寸、主题、字号、数据都与基线一致。至少截浅色和深色；涉及布局的加最小窗口 1000×680 和 UI 24px；有弹层或状态变化的加对应状态。
4. **比对：**逐对检查裁切、溢出、换行、对齐、颜色是否跟随主题；需要时在 scratchpad 生成并排图或差异图。每对写一句结论。
5. **输出：**截图存到 `test/日期-主题/`，命名 `before|after-light|dark-宽x高[-字号].png`，在报告中引用。最后把前后对比截图发到对话中（Claude Code 用 `SendUserFile`，其他客户端用图片附件），附一句结论。
6. 测试环境起不来时，申请沙盒外执行或请用户在系统终端启动；仍不行就记为“未验”，不用类型检查代替。

## 环境约束

- 拉起 Electron 前要经过 `assertElectronLaunchAllowed()`；遇 `DEEPWRITE_ELECTRON_SANDBOX` 见 [error/electron-sandbox.md](error/electron-sandbox.md)。
- 临时 harness 和探针页放 scratchpad，用完删除；需要留存的产物另存到 `test/`。
- **真实模型：**开发环境（`pnpm dev`，与安装版共用用户配置）里已配置的模型可以直接用来测试，用户已同意消耗其 token，不必为省用量跳过真实模型验证。不读取、不输出密钥，报告、产物和日志里都不写；长任务先用小样本跑通。
- 不在用户本机的真实作品上跑长任务或写入，改用副本或合成夹具。结束端口进程前先核对命令行（[error/process-kill.md](error/process-kill.md)）。
- **重启开发环境：**改了 Main、Preload、Utility 或 `packages/` 的运行时代码后，正在运行的开发版热加载跟不上，接着测会测到旧代码。测试前可以直接强制结束上一个开发版 Electron 进程，再用 `pnpm dev` 重新起一个。先用 `ps` 核对它是本仓库的 `electron .`；`bridge-entry.js` 是 MCP 桥，不要动。先结束 Electron，再结束 electron-vite：顺序反了，Main 的输出管道已关闭，退出时会弹 `write EIO` 错误框并卡住，只能 `kill -9`。

## 报告规范

- 功能开发、缺陷修复、样式改动和有产物的验证写报告；简单改动只在回复中说明验证了什么。
- 报告写在 `test/YYYY-MM-DD-主题.md`，产物放同名目录。同一任务的多轮验证追加到同一份报告。
- 报告不超过 40 行，分五节：目标与成功标准 / 环境 / 步骤与命令（注明级别）/ 结果（通过、失败、未验）/ 未覆盖与后续。
- 产物只放合成数据、采样结果和截图。不含私有正文、密钥、真实地址（地址用 `example.test`）；单个文件不超过 1 MB，不放 `*.test.*`。
- 写完在下表加一行，结论不超过 20 字；被新报告取代的旧行删掉。

## 验证记录

| 日期 | 主题 | 结论 | 报告 |
| --- | --- | --- | --- |
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
