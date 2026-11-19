# 新建作品下拉菜单定位修复

## 目标与成功标准

菜单不覆盖弹窗底部操作栏；滚动隐藏触发字段后关闭；选择与键盘操作保持可用。

## 环境

macOS、Electron 42.5.0，独立临时 userData；实际 CreateBookDialog、PopupSelect 与全局主题样式，合成技能库，无真实作品。

## 步骤与命令（L1 / L2）

- 先增加定位与滚动回归测试：修复前两项失败，修复后通过。
- `pnpm vitest related --run apps/desktop/src/renderer/src/composables/usePopupSelect.ts`：7 文件、59 项通过。
- 定位与原有 PopupSelect 测试：2 文件、5 项通过；`pnpm typecheck`、ESLint、Prettier 通过。
- Electron 探针：同条件截取浅色／深色 1200×900、14px 和 1000×680、24px 前后截图。
- 补测 24 个合成技能的长菜单、菜单内滚动、选择更新、键盘打开及 Esc 关闭并恢复焦点。

## 结果

- 浅色 1200×900：原菜单占据底栏，修复后向上展开，按钮无遮挡。
- 深色 1200×900：菜单位置修复，主题颜色保持正常。
- 浅色 1000×680、24px：向上展开，无菜单裁切和越界。
- 深色 1000×680、24px：向上展开，文字与选中状态可辨。
- 四种条件下，滚动至触发字段不可见后菜单均关闭；长列表和键盘交互全部通过。
- [前后定位采样](2026-11-16-popup-select-position/before.json)、[修复后采样](2026-11-16-popup-select-position/after.json)、[前后对照图](2026-11-16-popup-select-position/comparison.png)。

## 未覆盖与后续

Windows 实机未验；工作区既有分栏性能改动保留，本次未修改。
