# 窗口自动记住大小与默认模式切换

## 目标与成功标准

设置页“启动窗口大小”默认开启“自动记住大小”，缩放窗口自动防抖保存并实时显示宽高；切到“默认大小 1200 × 800”后固定按默认启动，不随拖动更新。

## 环境

macOS、Electron、独立临时 userData；合成外观配置，无真实作品与网络请求。

## 步骤与命令（L1 / L2）

- L1：`pnpm vitest related --run apps/desktop/src/renderer/src/composables/useAppearance.ts apps/desktop/src/renderer/src/composables/useAppearance.close.test.ts apps/desktop/src/main/ipc/appearance-commands.ts apps/desktop/src/renderer/src/components/StartupWindowSettings.vue`（6 文件 47 项）与补充单测（4 文件 37 项）。
- L1：ESLint 与 Prettier 检查所有改动文件。
- L2：`pnpm lint:i18n`、`pnpm lint:boundary`、`pnpm typecheck`、`pnpm build`（含语言包体积预算校验）。
- L2 桌面冒烟：`node apps/desktop/scripts/electron-startup-window-smoke.mjs`（`capture` / `restore` / `default` 三阶段）。
- L2 视觉探针：同条件截取改前/改后浅色与深色 1200×800（14px）及 1000×680（24px）。

## 结果

- 通过：6 文件 47 项与 4 文件 37 项单元测试全部通过；`lint:i18n`、`lint:boundary`、`typecheck`、`build`、ESLint 与 Prettier 通过。
- 通过：`electron-startup-window-smoke.mjs` 验证缩放自动保存 1400×900、重启恢复、切换默认模式后缩放 500ms 不覆盖 `null`、再重启恢复 1200×800。
- 通过：视觉对比确认 4 种条件下双模式按钮无溢出裁切、主题色对比正常，实时显示当前宽高。
- 对比产物：[基线采样](2026-11-17-window-auto-size/before-samples.json)、[改后采样](2026-11-17-window-auto-size/after-samples.json)、[浅色 1200×800](2026-11-17-window-auto-size/after-light-1200x800.png)、[深色 1000×680 24px](2026-11-17-window-auto-size/after-dark-1000x680-24px.png)。

## 未覆盖与后续

Windows 实机窗口边框及多显示器缩放场景未验，留待后续跨平台构建验证。
