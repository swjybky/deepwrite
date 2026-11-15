# 技能与团队广场合并

## 目标与成功标准

- 侧边栏和设置只显示“技能和团队广场”，页面用技能 / 团队 Tab 切换。
- 保留浏览、我的发布、发布入口；旧团队入口进入团队 Tab。
- 任一旧广场可见时保留合并入口，两者均隐藏时保持隐藏。

## 环境

- macOS、Electron 42.5.0、Vite 合成夹具、临时 userData，无真实作品或远程写入。

## 步骤与命令（L1 / L2）

- 6 个定向 Vitest 文件共 60 项通过；更新导航断言后单独复测侧边栏 11 项。
- typecheck、改动文件 ESLint / Prettier、lint:i18n、build 与体积预算、git diff --check 通过。
- Electron 验证点击、方向键 / Home 键切换及焦点，两类页面三个子入口。
- 截取浅色 / 深色 1200×900（14px）、1000×680（24px）的改前、改后及团队 Tab。

## 结果

- 通过：合并配置、四种旧显隐组合、原入口导航、夹具登录会话传递及 Tab 交互。
- 浅色 1200×900：Tab 与内容左缘对齐，无新增横向溢出。
- 深色 1200×900：选中项、背景和文字跟随主题。
- 浅色 1000×680 / 24px：Tab 完整可见，原页面可垂直滚动。
- 深色 1000×680 / 24px：布局正常，原有账号按钮换行保持原状。
- [浅色对比](2026-11-15-marketplace-tabs/comparison-light.png)、[深色对比](2026-11-15-marketplace-tabs/comparison-dark.png)、[交互结果](2026-11-15-marketplace-tabs/interactions.json)。

## 未覆盖与后续

- 未验证 Windows 实机及远程发布、安装；复用原有业务实现。
- 保留工作区原有更多功能和编辑器改动，本次未提交。

## Tab 外观调整

- 改为文字与短下划线，配合细分隔线和更紧凑的页头间距；颜色跟随主题。
- Electron 改前、改后各 8 张截图：两种主题、两档尺寸字号、技能与团队状态；无 Tab 溢出，键盘切换与焦点通过。
- 四组对比：浅色 / 深色常规窗口层级清晰；浅色 / 深色最小窗口 24px 无裁切，内容可滚动。
- ESLint、Prettier、git diff --check 通过；本轮仅改 CSS，未新增业务测试。
- [外观前后对比](2026-11-15-marketplace-tabs/restyle-comparison.png)、[采样结果](2026-11-15-marketplace-tabs/restyle-after.json)。
