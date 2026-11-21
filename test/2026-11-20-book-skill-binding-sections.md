# 绑定列表技能分区验证

## 目标与成功标准

技能绑定列表按分组、技能库、单个技能排序，各有标题与分隔线。勾选分组应同步勾选其成员库。零散技能可搜索和查看，移入技能库后沿用整库绑定。

## 环境

macOS Electron，仓库开发版 Renderer 与隔离数据目录，使用合成样书、技能库和技能条目。前后对照用同一组件探针，浅色与深色分别覆盖 1280×800、14px 和 1000×680、24px。

## 步骤与命令

- L1 `pnpm exec vitest related --run` 覆盖绑定列表相关四个文件。另跑 `App.performance.test.ts`。改动源码通过 ESLint、Prettier 和 `pnpm lint:i18n`。
- L2 `pnpm exec vue-tsc --noEmit -p apps/desktop/tsconfig.web.json`。Electron Vite 输出到隔离目录，运行 Renderer 体积检查。
- 开发版从作品菜单进入，搜索零散技能，勾选分组，再选一个技能库。保存后从 Core 重新读出绑定和重开弹窗核对。

## 结果

- 60 项相关测试通过，性能测试通过。Renderer 启动应用代码与语言数据均在预算内。
- 分组勾选同步到两个成员库，部分勾选时分组显示半选。保存写入三个技能库 ID，重开后复选框与左侧概览一致。逐帧采样确认分组勾选只变化一次、其他库保持可操作、弹窗高度稳定。
- [作品菜单](2026-11-20-book-skill-binding-sections/01-绑定入口.png) → [三段列表](2026-11-20-book-skill-binding-sections/02-打开绑定.png) → [搜索单个技能](2026-11-20-book-skill-binding-sections/03-搜索单个技能.png) → [勾选分组](2026-11-20-book-skill-binding-sections/04-勾选分组.png) → [另选技能库](2026-11-20-book-skill-binding-sections/05-另选技能库.png) → [保存反馈](2026-11-20-book-skill-binding-sections/06-保存反馈.png) → [重开核对](2026-11-20-book-skill-binding-sections/07-重新打开核对.png)。
- 1280×800、14px 浅色下三段同屏，标题与项目对齐。[前后并排](2026-11-20-book-skill-binding-sections/compare-light-1280x800-14.png)
- 1280×800、14px 深色下标题、分隔线和条目对比清晰。[改前](2026-11-20-book-skill-binding-sections/before-dark-1280x800-14.png) · [改后](2026-11-20-book-skill-binding-sections/after-dark-1280x800-14.png)
- 1000×680、24px 浅色下列表独立滚动，页脚始终可用。[改前](2026-11-20-book-skill-binding-sections/before-light-1000x680-24.png) · [改后](2026-11-20-book-skill-binding-sections/after-light-1000x680-24.png) · [滚动到底](2026-11-20-book-skill-binding-sections/after-light-1000x680-24-单个技能.png)
- 1000×680、24px 深色下行文字无横向溢出，滚动到底可完整看到单个技能及入库提示。[改前](2026-11-20-book-skill-binding-sections/before-dark-1000x680-24.png) · [改后](2026-11-20-book-skill-binding-sections/after-dark-1000x680-24.png) · [滚动到底](2026-11-20-book-skill-binding-sections/after-dark-1000x680-24-单个技能.png)

## 未覆盖与后续

桌面落盘流程以短篇样书验证。Windows 未实测。
