# 五类作品管理弹窗统一

## 目标与成功标准
五类作品使用固定尺寸外壳和分组导航，原管理操作继续可用，次级弹窗保留父窗口尺寸与位置。

## 环境
macOS · Electron 隔离探针 · 合成作品与替身 IPC。基线截图在编辑源码前采集。

## 步骤与命令
- L1：`pnpm vitest run <13 个相关测试文件>`，73 项通过。覆盖管理路由、目录数据、长篇变更与剧本杀冲突。
- L1：变更文件的 `pnpm exec eslint`、`pnpm exec prettier --check` 与 `pnpm lint:i18n` 通过。
- L2：`pnpm --filter @deepwrite/desktop exec vue-tsc --noEmit -p tsconfig.web.json` 通过。中间检查曾报 `TS2339: Property currentBookId does not exist`，已改为传入 `bookId`。
- L2：改前和改后 `pnpm build` 通过。Renderer 应用 JS 1,229,404 → 1,230,186 B，语言数据 838,241 → 835,361 B，启动 JS + 语言数据 2,115,471 → 2,113,373 B，CSS 约 854.18 → 825.87 kB。预算未改。

## 结果
- 五类全部 19 个分区在 1200×850 下均为 960×680，位置 (120, 85)。1000×680 下均为 952×632，位置 (24, 24)。深浅主题、10–24px 字号、加载、空列表、长列表与子弹窗通过。[尺寸实测](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/after-dimensions.json) · [基线](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/before-dimensions.json)
- 验证角色结构转换、阶段增删改与排序/启停、各类保存入口、短篇和长篇改名回调、旧版本预览、剧本杀冲突重读与焦点恢复。[交互记录](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/interactions.json) · [改动清单](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/changed-files.md)
- 沿用产品已有的「剧情结构」名称。长篇将旧档案导入保留为专用预览，预览叠加在管理弹窗上。

| 截图 | 改前 | 改后 | 比对 |
| --- | --- | --- | --- |
| 短篇结构 | [改前](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/before-light-1200x850-short-structure.png) | [改后](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/after-light-1200x850-short-structure.png) | 分组导航与结构列表统一 |
| 短篇上下文 | [改前](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/before-light-1200x850-short-context.png) | [改后](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/after-light-1200x850-short-context.png) | 文本域填满右栏 |
| 剧本结构 | [改前](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/before-light-1200x850-script-structure.png) | [改后](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/after-light-1200x850-script-structure.png) | 条目操作与短篇一致 |
| 剧本上下文 | [改前](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/before-light-1200x850-script-context.png) | [改后](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/after-light-1200x850-script-context.png) | 切换后外框保持尺寸 |
| 长篇结构 | [改前](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/before-light-1200x850-long-structure.png) | [改后](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/after-light-1200x850-long-structure.png) | 两层标签拆成左栏分区 |
| 小说上下文 | [改前](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/before-light-1200x850-long-context.png) | [改后](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/after-light-1200x850-long-context.png) | 字数和保存统一到编辑区底部 |
| 剧本杀集合 | [改前](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/before-light-1200x850-mystery-structure.png) | [改后](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/after-light-1200x850-mystery-structure.png) | 同一套条目和按钮 |
| 剧本杀上下文 | [改前](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/before-light-1200x850-mystery-context.png) | [改后](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/after-light-1200x850-mystery-context.png) | 分区排列在左栏末尾 |
| 学术框架 | [改前](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/before-light-1200x850-academic-structure.png) | [改后](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/after-light-1200x850-academic-structure.png) | 阶段列表采用统一行样式 |
| 学术上下文 | [改前](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/before-light-1200x850-academic-context.png) | [改后](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/after-light-1200x850-academic-context.png) | 沿用同一编辑与保存布局 |
| 深色 · 长篇 | [改前](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/before-dark-1200x850-14-structure.png) | [改后](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/after-dark-1200x850-14-structure.png) | 背景、分隔线和选中项跟随主题 |
| 1000×680 · 长篇 | [改前](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/before-light-1000x680-14-context.png) | [改后](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/after-light-1000x680-14-context.png) | 两侧各留 24px，底部操作可见 |
| 24px · 长篇 | [改前](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/before-light-1000x680-24-structure.png) | [改后](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/after-light-1000x680-24-structure.png) | 说明能换行，外框居中 |
| 10px · 长篇 | [改前](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/before-light-1200x850-10-context.png) | [改后](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/after-light-1200x850-10-context.png) | 外框仍为 960×680 |
| 短篇新建子弹窗 | [改前](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/before-light-1200x850-14-child.png) | [改后](/Users/wenjia/project/deepwrite/test/2026-11-18-book-management-dialog/after-light-1200x850-14-child.png) | 主弹窗保持尺寸和位置 |

## 未覆盖
未用真实作品落盘，未执行系统文件选择器、旧档案实际导入或 Windows 桌面验收。

## 返工

头部只显示「类型 · 管理」，作品名保留在名称行。列表按名称、说明、元信息排列。稳定 ID 使用小号等宽字体和三级文字色，「默认」「内置」「自定义」使用与 ID 同行的弱底细边标签。短篇、剧本的剧情结构和长篇人物类型脚注距列表统一为 12px。行操作沿用全局图标按钮样式，尺寸跟随 UI 字号，点击区下限为 24px。

### 命令与结果

以下命令在仓库根目录执行。第一组运行上一轮相同的 13 个文件，73 项通过。

```zsh
renderer=apps/desktop/src/renderer/src
pnpm vitest run \
  "$renderer"/components/{WorkspaceDialogLayer,LongWorkspace.rollback-bindings-and-structure}.test.ts \
  "$renderer"/composables/{useWorkspaceDialogModuleCoordinator,useLongStructureDeleteConfirmation,useLongStructureFormImpact,useLongStructureTransactionsCoordinator,useLazyLongStructureTransactionsCoordinator}.test.ts \
  "$renderer"/types/longStructureMutations.test.ts \
  "$renderer"/data/{catalogWorkspace,catalogWorkspace.academic}.test.ts \
  "$renderer"/features/mystery/useMysteryDocument.test.ts \
  "$renderer"/utils/mysteryWorkspaceResourceTree.test.ts \
  "$renderer"/App.performance.test.ts
```

- `pnpm exec eslint <本次修改的 Vue、TS 文件>`、`pnpm exec prettier --check <本次修改的 Vue、TS、CSS 文件>`、`pnpm lint:i18n` 均通过。
- `pnpm --filter @deepwrite/desktop exec vue-tsc --noEmit -p tsconfig.web.json` 通过。
- `pnpm build` 通过。Renderer 启动体积校验使用原有预算。

| 构建指标 | 实测（B，原始大小） | 预算（B） |
| --- | ---: | ---: |
| Renderer 应用 JS | 1,230,186 | 1,235,000 |
| 国际化运行时 JS | 47,826 | 60,000 |
| 应用就绪 JS | 1,278,012 | 1,295,000 |
| 语言数据 | 835,355 | 845,000 |
| 应用就绪 JS + 语言数据 | 2,113,367 | 2,140,000 |
| Renderer CSS 产物合计 | 826,645 | — |

### Electron 实测

沿用上一轮的合成作品和替身 IPC，启动前调用 `assertElectronLaunchAllowed()`。五类 19 个分区在五组主题、视口和字号下共测 95 次，另测短篇新建子弹窗打开时的父弹窗。1200×850 下为 960×680，坐标 (120, 85)。1000×680 下为 952×632，坐标 (24, 24)。所有测量与返工前一致，已用新结果覆盖同名 JSON。[尺寸实测](2026-11-18-book-management-dialog/after-dimensions.json)

五类行操作在 10、14、24px 下的图标边长约为 11.4、16.0、27.4px，点击区边长约为 24.0、32.0、54.8px，启用按钮中心命中通过。确认默认／内置／自定义标签、ID 与说明的字号层级、脚注间距，以及各分区内容区无横向溢出。夹具交互复测结果与上一轮一致。[交互记录](2026-11-18-book-management-dialog/interactions.json)

| 重截图 | 比对结果 |
| --- | --- |
| [短篇剧情结构](2026-11-18-book-management-dialog/after-light-1200x850-short-structure.png) | ID 缩小，脚注距列表为 12px |
| [学术框架](2026-11-18-book-management-dialog/after-light-1200x850-academic-structure.png) | 标识为小标签，与 ID 同行 |
| [长篇世界观类别](2026-11-18-book-management-dialog/after-light-1200x850-long-structure.png) | 名称、说明与 ID 层级清楚 |
| [剧本杀设定文档](2026-11-18-book-management-dialog/after-light-1200x850-mystery-structure.png) | 头部收紧，行操作对齐 |
| [最小窗口 · 24px](2026-11-18-book-management-dialog/after-light-1000x680-24-structure.png) | 行操作随字号放大，列表可用 |
| [深色 · 14px](2026-11-18-book-management-dialog/after-dark-1200x850-14-structure.png) | ID 使用深色主题的三级文字色 |
| [短篇新建子弹窗](2026-11-18-book-management-dialog/after-light-1200x850-14-child.png) | 子窗居中，父窗尺寸和位置一致 |

未覆盖真实作品落盘、系统文件选择器、旧档案实际导入及 Windows 桌面。
