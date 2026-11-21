# 绑定名称悬浮提示验证

## 目标与成功标准

悬浮「当前绑定」里的技能库、素材库或团队行时，名称被省略才在行右侧显示全名。超长名称自动换行，指针移开后提示消失。

## 环境

macOS Electron 隔离探针，使用实际绑定弹窗、Pinia、应用样式及合成数据。窗口 1000×680，浅色 14px、深色 24px。

## 步骤与命令

- L1 `pnpm exec vitest run apps/desktop/src/renderer/src/components/BookBindingsDialog.test.ts`、改动文件的 ESLint 与 Prettier 检查。
- 首轮界面流程：[绑定入口](2026-11-20-book-bindings-hover/01-绑定入口.png) → [打开弹窗](2026-11-20-book-bindings-hover/02-打开弹窗.png) → [技能库](2026-11-20-book-bindings-hover/after-light-1000x680-14.png) → [素材库](2026-11-20-book-bindings-hover/04-素材库名称.png) → [团队](2026-11-20-book-bindings-hover/05-团队名称.png) → [超长名称换行](2026-11-20-book-bindings-hover/06-长名换行.png)。
- 第二轮界面流程：[绑定入口](2026-11-20-book-bindings-hover/right-side/01-绑定入口.png) → [打开弹窗](2026-11-20-book-bindings-hover/right-side/02-打开弹窗.png) → [悬浮被截断项](2026-11-20-book-bindings-hover/right-side/after-light-1000x680-14-long.png) → [悬浮完整项](2026-11-20-book-bindings-hover/right-side/after-light-1000x680-14-short.png) → [超长名称换行](2026-11-20-book-bindings-hover/right-side/05-超长名换行.png) → [团队名称](2026-11-20-book-bindings-hover/right-side/06-团队名称.png)。

## 结果

- 首轮 3 项组件测试与格式检查通过。悬浮到行内图标位置即显示对应全名，一次只有一条提示，移开后消失。
- 浅色 14px 下行内名称保持单行省略，提示能越过左侧滚动区显示。[改前](2026-11-20-book-bindings-hover/before-light-1000x680-14.png)、[改后](2026-11-20-book-bindings-hover/after-light-1000x680-14.png)
- 深色 24px 下提示跟随主题和字号，内容显示完整，弹窗布局保持稳定。[改前](2026-11-20-book-bindings-hover/before-dark-1000x680-24.png)、[改后](2026-11-20-book-bindings-hover/after-dark-1000x680-24.png)
- 第二轮 3 项组件测试、格式检查与探针通过。探针核对三类截断项、已显示完整的短名，以及悬浮期间由截断变为完整后提示消失。
- 浅色 14px 下提示移至行右侧，左栏下方条目可见，完整名称悬浮时没有提示。[长名改前](2026-11-20-book-bindings-hover/right-side/before-light-1000x680-14-long.png)、[长名改后](2026-11-20-book-bindings-hover/right-side/after-light-1000x680-14-long.png)、[短名改前](2026-11-20-book-bindings-hover/right-side/before-light-1000x680-14-short.png)、[短名改后](2026-11-20-book-bindings-hover/right-side/after-light-1000x680-14-short.png)
- 深色 24px 下提示与行对齐且文字完整，超长名称换行后仍在窗口内。[长名改前](2026-11-20-book-bindings-hover/right-side/before-dark-1000x680-24-long.png)、[长名改后](2026-11-20-book-bindings-hover/right-side/after-dark-1000x680-24-long.png)、[短名改前](2026-11-20-book-bindings-hover/right-side/before-dark-1000x680-24-short.png)、[短名改后](2026-11-20-book-bindings-hover/right-side/after-dark-1000x680-24-short.png)

## 未覆盖与后续

未在 Windows 实测。入口截图来自隔离样书，验证范围为绑定弹窗的悬浮交互。
