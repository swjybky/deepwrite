# 2026-11-20 左侧创作目录统一长按拖拽排序验收

- **范围**：左侧栏 `SidebarResourceList.vue`（统一 `useSidebarOrderDrag` / `useRowOrderDrag` / `resolveSidebarOrderDrag`）与创作空间各域独立持久化。
- **隔离方式**：使用临时 `mkdtemp` 根目录与 `ELECTRON_RUN_AS_NODE=""` 启动独立 Electron 实例（`apps/desktop/out/main/index.js`），不触碰用户真实目录。
- **实测步骤与结论**：
  1. 运行 `node apps/desktop/scripts/electron-smoke.mjs --library-groups-only`：素材库与技能库分组、长按拖拽排序及核心链路全部通过。
  2. 短篇创作目录真实鼠标长按（`430ms`）实测：
     - **剧情阶段**：`剧情细化` 拖至 `剧情设计` 前，浮层卡片、源位虚线占位与蓝色落点线显示正常，重载后持久化为 `[plot_refine, plot_design, ...]`。
     - **人物阶段**：列表模式下 `人物丙` 拖至 `人物甲` 前，浅色与深色模式下交互和重载持久化均正常（`人物乙 -> 人物丙 -> 人物甲`）。
     - **正文**：`第二节` 拖至 `导语` 前，落盘后重载保持新顺序且不破坏原有选中编辑焦点。
     - **素材库**：复用同一套长按拖拽入口，将 `素材库乙` 拖至 `素材库甲` 前并持久化。
- **截图**：[test/2026-11-20-sidebar-creation-row-order-drag/](file:///Users/wenjia/project/deepwrite/test/2026-11-20-sidebar-creation-row-order-drag/)（含 `01-before-light.png`、`02-mid-drag-plot-light.png`、`03-after-reorder-light.png`、`04-mid-drag-dark.png`、`05-after-dark.png`）。
