# 技能广场已安装状态

## 目标与成功标准

- 已安装同版本的单技能、技能库和技能组，卡片与详情均显示禁用的「已安装」。未安装的版本可继续安装。
- 安装完成后刷新本地目录，卡片随即显示「已安装」。移除当前版本后恢复安装入口。

## 环境

- macOS、Electron 隔离探针、合成广场和本地目录数据。浅深色均为 1180 × 760、14 px。

## 步骤与命令

- L1 先运行新增用例复现缺少禁用状态，再对 `SkillMarketplacePage.vue` 和对应测试执行 `pnpm exec vitest related --run`、ESLint、Prettier。
- L2 执行 `pnpm exec vue-tsc --noEmit -p apps/desktop/tsconfig.web.json`。在 Electron 中打开详情、尝试点击禁用按钮、安装新版本并更新目录。

## 结果

- 71 项定向测试、Renderer 类型检查、ESLint 和 Prettier 通过。
- Electron 验证三个已安装条目的卡片和详情都无法触发安装预览。不同内容类型共用远程 ID 时各自显示正确状态。新版本可打开预览，安装后的目录刷新与移除后的状态恢复通过。
- 浅深色的卡片与详情按钮保持对齐，禁用态清晰可见。截图左侧改前，右侧改后。[浅色卡片](2026-11-18-skill-marketplace-installed/compare-light-1180x760-cards.png) · [浅色详情](2026-11-18-skill-marketplace-installed/compare-light-1180x760-detail.png) · [深色卡片](2026-11-18-skill-marketplace-installed/compare-dark-1180x760-cards.png) · [深色详情](2026-11-18-skill-marketplace-installed/compare-dark-1180x760-detail.png)

## 未覆盖

- 广场生产数据与 Windows 实机。
