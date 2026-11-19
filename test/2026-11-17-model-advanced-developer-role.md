# 模型高级配置支持禁用 developer 角色与自动兼容

## 目标与成功标准

在模型「高级配置」弹窗新增「不支持 `developer` 角色」开关且精简多余小字提示，样式与主题、字号兼容；接口拒绝 `developer` 角色时给出引导提示并支持测试／运行自动降级与落盘。

## 环境

macOS、Electron 42.5.0、独立临时 userData；合成模型配置与模拟 HTTP 响应（域名使用 `example.test`），无真实作品与真实网络请求。

## 步骤与命令（L1 / L2）

- L1：精简提示后复测 `ModelSettingsFeature.test.ts`、`messages.test.ts`、`errors.test.ts`（3 文件 43 项，前置完整改动涵盖 10 文件 171 项），ESLint（`--max-warnings=0`）、Prettier 与 `pnpm lint:i18n`。
- L2：`pnpm build`（含启动与语言包预算）与 Electron 视觉探针。
- L2 视觉探针：同条件截取改前（HEAD worktree）与精简后 `ModelAdvancedConfigDialog` 浅色／深色 1200×800（14px，含开关开启态）、1000×680（24px）并等待 CSS 过渡完成后采图与逐帧采样开关切换。

## 结果

- 通过：3 文件 43 项复测与前置 10 文件 171 项单测、ESLint、Prettier、`lint:i18n` 与 `pnpm build`（语言数据 `843,779 B < 845,000 B`）通过。
- 通过：视觉对比确认 5 组改后截图（浅/深 1200×800 高 `322px`、浅/深 1000×680 24px 高 `374px`、浅色开启态）均无裁切或溢出，配色与开关滑块稳定过渡，开关逐帧切换高度恒定 `322px`。
- 对比产物：[基线采样](2026-11-17-model-advanced-developer-role/before-samples.json)、[改后采样](2026-11-17-model-advanced-developer-role/after-samples.json)、[浅色 1200×800](2026-11-17-model-advanced-developer-role/after-light-1200x800.png)、[浅色开启态](2026-11-17-model-advanced-developer-role/after-light-1200x800-checked.png)、[深色 1200×800](2026-11-17-model-advanced-developer-role/after-dark-1200x800.png)、[浅色 1000×680 24px](2026-11-17-model-advanced-developer-role/after-light-1000x680-24px.png)、[深色 1000×680 24px](2026-11-17-model-advanced-developer-role/after-dark-1000x680-24px.png)。

## 未覆盖与后续

Windows 实机界面及真实魔搭服务端实时请求未在本次验证，留待真机或有密钥环境实测。
