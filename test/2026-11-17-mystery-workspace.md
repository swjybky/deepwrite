# 剧本杀创作空间与智能体

## 目标与成功标准

- 独立实现剧本杀五阶段工作区（`truth` / `characters` / `scripts` / `clues` / `dm`）、`roles × acts` 二维矩阵、提案与版本历史。
- 复用共享素材/技能池与版本配图机制，配置 1 个主控与 4 个默认停用的团队子智能体；支持防剧透 `.docx` / `.md` 分本导出与外部 MCP。
- 严格隔离在 `deepwrite-mystery` worktree，守住 Renderer 导入边界与首屏包体预算。

## 环境

- macOS、Node/pnpm workspace、Electron 42.5.0、临时隔离 `userData` 与合成夹具「雾钟山庄」（无真实作品或远程请求）。

## 步骤与命令（L1 / L2）

- **L1（静态与单测）：** `pnpm typecheck`、`pnpm lint`（ESLint / Boundary / i18n）、`pnpm build`、`pnpm smoke:renderer`；三轮定向 Vitest 共 31 文件 / 244 用例通过（18 文件 / 167 项覆盖契约、Pi 运行时、Disk 集成、`mystery` MCP、主进程配置与 Renderer 组件；12 文件 / 76 项覆盖 `document-versions` 与 `book-images`；1 文件 / 1 项覆盖防剧透导出集成）。
- **L2（Electron 冒烟与视觉）：** `electron-smoke.mjs` 四项定向用例（`--conversation-only`、`--external-concurrency-only`、`--library-entries-only`、`--library-groups-only`）；隔离 Electron E2E（新建「雾钟山庄」、6 角 4 幕第二人称写作、11 文件防剧透 `.docx` 开本包导出）并采图核对浅色 / 深色、`1440×900` / `1000×680`、`14px` / `24px`。

## 结果

- **通过：** 静态检查、Renderer 懒加载预算（`MysteryWorkspaceModule` `46.50 kB`，首屏 `178,063 B` / app-ready `1,238,016 B`）、31 文件 244 项 Vitest、4 项定向 Electron 冒烟、Electron 真 UI 建书与防剧透导出均通过；`1000×680` 与 `24px` 字体下横向溢出为 `0`。实机排查并修复了三处真实缺陷：首次新建未建 `mystery-books/` 父目录、Reactive Proxy 跨 `contextBridge` 克隆失败、`readDocument` 超 20 万字符校验上限。
- **对比与过程截图：** [创建弹窗](2026-11-17-mystery-workspace/after-create-book-mystery-1440-light.png)、[工作区阶段1](2026-11-17-mystery-workspace/after-left-sidebar-1440-light.png)、[阶段3浅色](2026-11-17-mystery-workspace/after-mystery-workspace-stage3-1440-light.png)、[阶段3深色](2026-11-17-mystery-workspace/after-mystery-workspace-stage3-1440-dark.png)、[窄屏1000x680](2026-11-17-mystery-workspace/after-mystery-workspace-1000x680.png)、[字号24px](2026-11-17-mystery-workspace/after-mystery-workspace-font24.png)、[智能体设置](2026-11-17-mystery-workspace/after-settings-mystery-agent-1440-light.png)、[智能体团队](2026-11-17-mystery-workspace/after-agent-teams-mystery-1440-light.png)（基线对照见同目录 `before-*.png`）。
- **失败（既有问题，未改无关用例）：** 全量 `pnpm smoke` 停在 `Voice UI smoke timed out: recording state [正在开启麦克风…; visible]`（CLI 无头麦克风环境超时）；`--i18n-only` 报错 `Language smoke: more features missing`（`71d283a1` 精简侧边栏入口后旧冒烟断言未同步）。

## 未覆盖与后续

- 尚未在 Windows 实机验证安装与导出路径表现，亦未连接真实远程 LLM 实跑 `role_script_writer` / `dm_playtest_auditor` 多轮协作生成。
