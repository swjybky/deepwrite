# 绑定弹窗重设计验证

## 目标与成功标准

打开绑定弹窗即可同时看到技能库、素材库、团队三类的已绑定项，不必切换；已绑定项在左侧概览与右侧列表中都要醒目；可在概览直接解除绑定；保存只提交有改动的类别，部分失败可重试。

## 环境

macOS，临时 Electron 探针（Vite 直出 `BookBindingsDialog.vue`，真实 Pinia 与 i18n，合成库与团队数据，用完已删）；窗口 1000×680，浅色/深色，UI 14px 与 24px。

## 步骤与命令

- L1 `pnpm exec vitest related --run`（BookBindingsDialog 及相关 3 个文件 58 项）；`eslint --max-warnings=0`、`prettier --check`、`pnpm lint:i18n`。
- L2 `vue-tsc --noEmit -p apps/desktop/tsconfig.web.json`。
- 探针截图：改前打开状态；改后打开、团队、空绑定、未保存、24px 浅色与深色团队。

## 结果

- 通过：测试 3 项覆盖跨类别保留选择、概览一次列出三类并直接解绑（含失效库与团队）、部分失败后重试。
- 通过：弹窗固定 920×632（1000×680 窗口），切换类别尺寸不变；24px 下概览长名省略、不横向溢出。
- 通过：已绑定行用强调色底与描边，列表按打开时已绑定项置顶；失效项标“已失效”；未绑定团队显示当前启用团队。
- 截图：[改前](2026-11-20-book-bindings-redesign/before-light-1000x680.png)、[改后](2026-11-20-book-bindings-redesign/after-light-1000x680.png)、[团队](2026-11-20-book-bindings-redesign/after-light-1000x680-team.png)、[未保存](2026-11-20-book-bindings-redesign/after-light-1000x680-unsaved.png)、[空绑定](2026-11-20-book-bindings-redesign/after-light-1000x680-empty.png)、[24px](2026-11-20-book-bindings-redesign/after-light-1000x680-24.png)、[深色](2026-11-20-book-bindings-redesign/after-dark-1000x680.png)。

## 未覆盖与后续

未跑 `pnpm build`（新文案用 `registerFeatureMessages` 放在懒加载弹窗块，不进启动语言数据）；未在开发版真实作品上点保存走 IPC（保存逻辑沿用原实现）；Windows 未验。
