# 长篇分栏拖动性能排查与修复

## 目标与成功标准

- 复现长篇左右分栏卡顿，定位随目录规模放大的热点；消除隐藏列表的尺寸工作，保留拖动、键盘与宽度保存行为。

## 环境

- macOS、Electron 42.5.0，独立临时 userData；真实 Renderer 组件与合成数据，未修改真实作品。
- 性能窗口实测 1600×900；长篇 1000 章导航、当前正文 103,890 字符、100 轮聊天；短篇对照正文与聊天相同、目录 20 项。
- 每项 90 步、每动画帧一步；通过 CDP Performance / Profiler、Vue 更新钩子和 MutationObserver 采集；单次配对，无 CPU 降速。

## 步骤与命令（L1 / L2）

- 临时 Vite / Electron 探针：基线从 HEAD 只读加载两份改前源码，对照当前文件；采集编辑 / 预览、左右拖动。采样与源码指纹见 [summary.json](2026-11-16-long-pane-resize/summary.json)，原始数据见 [改前](2026-11-16-long-pane-resize/before-all.json)、[改后](2026-11-16-long-pane-resize/after-all.json)。
- 34 个相关回归用例通过（尺寸监听、内部把手、长篇布局、搜索高亮、外层布局 Store）；新增的停用监听与复用尺寸用例在改前失败。
- 改动文件 ESLint / Prettier、Renderer vue-tsc、`pnpm lint:boundary`、`pnpm build` 及构建预算通过。
- Electron 原生输入模拟：两种左右布局的外层把手、章节列表、剧情列表与嵌套列表，检查鼠标拖动、释放、键盘和持久化，见 [交互记录](2026-11-16-long-pane-resize/interactions.json)。

## 结果

- 根因：壳的 CSS 宽度变量默认继承，拖动使整棵目录 / 聊天子树重算样式；滚动锚点的几何读取迫使重算执行。隐藏内部分栏还更新宽度与样式，反复触发编辑器渲染。
- 修复：四个宽度用 `@property inherits: false`，把手沿 grid 列定位；列表仅启用时观察，回调复用 observer 尺寸，内部拖动复用单次测量。

| 长篇场景 | 帧间隔 P95（ms） | 样式重算合计（ms） | 编辑器更新次数 |
| --- | --- | --- | --- |
| 编辑 · 右侧 | 27.8 → 17.5 | 1298.7 → 56.0 | 83 → 0 |
| 编辑 · 左侧 | 32.0 → 17.7 | 1028.9 → 36.8 | 1 → 0 |
| 预览 · 右侧 | 31.5 → 17.7 | 1296.1 → 51.8 | 83 → 0 |
| 预览 · 左侧 | 29.0 → 17.7 | 1020.8 → 37.6 | 1 → 0 |

- 拖动阶段文档读取均为 0 次；短篇对照无帧间隔退化；原始 CPU profile 已留存同目录，地址归一化为 `renderer.example.test`。
- 1600×900 浅色、深色截图像素一致；1000×680 / UI 24px 浅色、深色原始截图分别仅 19、15 像素差异，四组几何测量一致，无新增布局位移。截图文件按 1× 保存。
- 四组截图：[常规浅色前](2026-11-16-long-pane-resize/before-visual-light-1600x900-14.png) / [后](2026-11-16-long-pane-resize/after-visual-light-1600x900-14.png)；[常规深色前](2026-11-16-long-pane-resize/before-visual-dark-1600x900-14.png) / [后](2026-11-16-long-pane-resize/after-visual-dark-1600x900-14.png)；[紧凑浅色前](2026-11-16-long-pane-resize/before-visual-light-1000x680-24.png) / [后](2026-11-16-long-pane-resize/after-visual-light-1000x680-24.png)；[紧凑深色前](2026-11-16-long-pane-resize/before-visual-dark-1000x680-24.png) / [后](2026-11-16-long-pane-resize/after-visual-dark-1000x680-24.png)。

## 未覆盖与后续

- 未在 Windows 实机或用户当前真实作品上测帧；未验证流式生成、搜索高亮开启、超长单段正文、高刷新率连续输入，不能据此宣称所有卡顿均已消除。
- deepwrite-dev MCP 仅确认开发环境就绪；当前连接来自另一工作目录，未切换或重启其正在运行的客户端。本次交互与性能证据来自独立 Renderer 探针。
