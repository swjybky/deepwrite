# 学术写作智能体与资料库自由共享

## 目标与成功标准

- 资料库支持精简预设与自定义标签，分组改为 `memberIds` 自由组合并兼容旧清单，全作品跨文体自由绑定。
- 新增 `academic` 作品（6 套子类型、5 档引用体例、底座文献证据卡、论证框架、单层与章→节三联正文）。
- 新增学术主创智能体（防幻觉与引用硬约束、统一 CRUD + `search`、剪枝恢复）及默认未勾选的 5 人学术团队。
- 支持按章/节勾选导出 `.md` 与 `.docx`（多级标题、三线表、公式、插图），同步外部控制 MCP，守住体积与行数预算。

## 环境

- macOS、Node 24.19.0、Electron 42.5.0、独立工作树 `deepwrite-academic`（`feat/academic-writing`）、临时 `userData` 夹具。

## 步骤与命令（L1 / L2）

- 定向与全包 Vitest：契约、Core 存储、资料库迁移与绑定、学术工具与剪枝、`.md`/`.docx` 导出、MCP 及 `App.performance.test.ts`。
- 静态与构建门禁：`pnpm format:check`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm smoke:renderer`、`git diff --check`。
- Electron 桌面冒烟与视觉采样：`--library-groups-only`、`--library-entries-only`、`--conversation-only`、`pnpm smoke:shutdown`，以及 1200×900（14px）与 1000×680（24px）浅色/深色改前改后截图。

## 结果

- 通过：全量静态门禁、预算检查（`WorkspaceShell.vue` 2791 行、语言包 844,582 B、启动应用 JS 1,198,680 B）及新增/回归测试全绿；定向桌面冒烟通过。
- 视觉比对：修正新建作品双列网格、学术弹窗语义表面色及右栏三联 Tab 窄栏折行挤压后，浅色/深色与 24px 下无横向溢出或文字重叠，见 [指标](2026-11-17-academic-writing-agent/visual-metrics.json) 及同目录 `before-*` / `after-*` 截图。
- 未验：全量 `pnpm smoke` 中的麦克风硬件录音子项在后台无权限超时；真实外部大模型长文生成与 Windows 实机安装包未跑。

## 未覆盖与后续

- `deepwrite-app` 移动端仓库若同步新版分组 `memberIds`、`customTag` 与 `academic` 清单，发版前需按 `error/schema-compat.md` 同步镜像 schema。
- 第二期可在导出弹窗扩展投稿套件（Cover Letter / Rebuttal）与对外解读衍生稿导出。
