# 技能条目去分类与广场旧数据兼容

## 目标与成功标准

- 单条技能可直接创建、从广场加入未绑定区，或放入任意可写技能库。正式技能库、素材库可设置分类。
- 旧版未绑定条目保留正文和 ID。广场旧库按库自身分类导入，保留正文、阶段、顺序，同版本重复加入不会产生副本。

## 环境

- macOS、Electron 隔离配置、临时作品目录。广场响应使用旧接口格式的合成数据。

## 步骤与命令

- L1 运行相关 Vitest 套件，并用 ESLint 和 Prettier 检查改动文件。
- L2 运行 `pnpm typecheck`、`pnpm lint:boundary`、`pnpm lint:i18n`、`pnpm build` 和 `node apps/desktop/scripts/electron-smoke.mjs --library-entries-only`。
- L2 在 Electron 验证旧库可选、未绑定创建和 10、14、24 px 布局。合成广场验证键盘切换、旧技能加入、旧素材详情及加入后刷新。

## 结果

- 113 项定向测试通过，含旧素材桥接与磁盘写入、旧版未绑定库复用、重复导入与新版本保留独立副本。
- 构建及启动体积检查、边界、多语言、ESLint 与 Prettier 通过。全仓类型检查报告了工作区既有剧本杀测试中的 `Promise<boolean>` 与 `Promise<void>` 类型不匹配。排除该用例后，Renderer、桌面 Node 及各包类型检查通过。
- Electron 新建条目浅深色对照通过。技能去掉分类栏，素材内容阶段正常。 [技能浅色](2026-11-18-library-classification/skill-entry-light.png) · [技能深色](2026-11-18-library-classification/skill-entry-dark.png) · [素材浅色](2026-11-18-library-classification/material-entry-light.png) · [素材深色](2026-11-18-library-classification/material-entry-dark.png)
- 广场搜索布局、素材正文预览与加入按钮在两种字号和深浅色下显示正常。截图上排为改前、改后，下排为素材列表、详情。 [浅色常规](2026-11-18-library-classification/plaza-light-1200x850-14.png) · [深色常规](2026-11-18-library-classification/plaza-dark-1200x850-14.png) · [浅色最小窗口](2026-11-18-library-classification/plaza-light-1000x680-24.png) · [深色最小窗口](2026-11-18-library-classification/plaza-dark-1000x680-24.png)

## 未覆盖

- 广场生产数据与 Windows 实机。工作区原有未提交改动保留。
