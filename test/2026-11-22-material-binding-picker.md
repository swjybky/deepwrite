# 素材库绑定分区验证

## 目标与成功标准

素材库沿用技能库的分组复选框、库列表和空状态。搜索和标签应能筛选分组，勾选半选分组应选中全部成员，已绑定库应排在最前。

## 环境

macOS，Playwright Chromium，1280×800，UI 14px。隔离探针加载真实 Vue 作品菜单、弹窗和主题，使用合成目录与内存保存回调。构建输出到临时目录。

## 步骤与命令

- L1 `pnpm exec vitest related --run` 指向改动的四个组件文件和 `App.performance.test.ts`。直接运行 `pnpm exec vitest run` 复核绑定弹窗和性能测试。
- L1 对改动文件运行 `pnpm exec eslint --max-warnings=0`、`pnpm exec prettier --check`，并运行 `pnpm lint:i18n`。
- L2 `pnpm exec vue-tsc --noEmit -p apps/desktop/tsconfig.web.json`。
- L2 `pnpm --filter @deepwrite/desktop exec electron-vite build --outDir <临时输出目录>`，运行原样复制到隔离目录的 `tools/check-renderer-build.mjs`。
- L2 在改源码前运行 Chromium 探针 `before`，改后运行 `after`，两次用相同的视口、字号、主题和初始绑定。

## 结果

- 改前新增的两项测试均复现 `Error: Missing aria-label=分组`。改后 66 项相关测试通过，单独复核的 7 项通过。ESLint、Prettier、多语言和 Renderer 类型检查通过。
- 构建和体积检查通过。启动应用 JS 1,228,366 B，i18n 运行时 47,826 B，语言数据 830,323 B，均在现有预算内。
- [浅色前后并排](2026-11-22-material-binding-picker/compare-light-1280x800-14.png) · [浅色技能库参照](2026-11-22-material-binding-picker/skill-reference-light-1280x800-14.png)。搜索框、分区标题和复选框沿用技能库对齐方式，组成员数完整显示。
- [深色前后并排](2026-11-22-material-binding-picker/compare-dark-1280x800-14.png) · [深色技能库参照](2026-11-22-material-binding-picker/skill-reference-dark-1280x800-14.png)。分隔线、半选与已绑定状态清晰。两种主题中列表及页脚均无横向溢出或裁切，技能库弹窗前后像素一致。
- [作品菜单](2026-11-22-material-binding-picker/01-绑定入口.png) → [素材分区与半选](2026-11-22-material-binding-picker/after-light-1280x800-14.png) → [搜索分组](2026-11-22-material-binding-picker/03-搜索分组.png) → [按标签筛选](2026-11-22-material-binding-picker/04-按标签筛选.png) → [勾选整组](2026-11-22-material-binding-picker/05-勾选分组.png) → [保存反馈](2026-11-22-material-binding-picker/06-保存反馈.png) → [重开核对](2026-11-22-material-binding-picker/07-重开核对.png)。组内被标签隐藏的成员也随整组保存。
- [无匹配](2026-11-22-material-binding-picker/03b-无匹配.png) · [加载中](2026-11-22-material-binding-picker/08-加载中.png) · [空库](2026-11-22-material-binding-picker/09-空库.png) · [有库无分组](2026-11-22-material-binding-picker/10-有库无分组.png)。另核对英文搜索占位。
- Electron 探针停在 `Waiting for Electron`，切换 Chromium 后完成截图。首次改后探针因用于查找素材行的名称漏写标签而报 `Locator.wait_for: Timeout 30000ms exceeded`，修正定位后全流程通过。

## 未覆盖与后续

探针保存到内存。桌面 Core 落盘、Windows 实机和安装包未验证。
