# 四类创作工作台一致性

## 目标与成功标准

从短篇、剧本、长篇进入剧本杀时，目录、对话和正文指向同一份稿件。四类作品的欢迎区、编辑工具和保存操作对齐。剧本杀继续按角色和幕次区分底牌、任务卡与玩家公开稿。

## 环境

macOS，Electron 42.5.0。四本合成作品使用相同的 Markdown 样稿。改前与改后 Renderer 均在隔离用户目录运行，使用同一正式构建的 Main、Preload 和 Core。截图尺寸为内容区的 CSS 像素。

## 步骤与命令

- L1 运行编辑、会话、导航、剧本杀协议、存储、导出和运行时相关的 29 个 Vitest 文件。变更源码通过 ESLint 和 Prettier 检查。
- L2 运行 `pnpm typecheck`、`pnpm lint:boundary`、`pnpm lint:i18n`、`pnpm build`、`pnpm smoke:conversation` 和 `pnpm smoke:shutdown`。
- L2 用 Electron 的真实组件和本地 IPC 写入后从 Core 回读。覆盖手动与自动保存、中文组词、全书搜索、原生右键选文、版本恢复，以及合成提案的定位、接受和撤销。手动保存期间逐帧检查光标、可编辑状态和页脚高度。

## 结果

- 剧本杀的五个大阶段已去掉数字前缀。在中英文桌面界面核对了左侧目录、输入框当前阶段和选择菜单中的路径，五个阶段的顺序与图标保留。[阶段名称对照](2026-11-18-writing-workspace-parity/compare-stage-names.png)
- 234 项定向测试和 39 项桌面交互通过。连续 8 次重新打开工作台，首次点击均直接选中剧本杀真相稿。四种作品均完成编辑、快捷键保存和持久化回读。剧本杀的冲突对照支持保留草稿、重载与确认覆盖，二次外部修改会触发重新核对。[交互记录](2026-11-18-writing-workspace-parity/interactions.json)
- 短篇、剧本和长篇的目录、对话与样稿相符，工具栏位置一致。[三类基准对照](2026-11-18-writing-workspace-parity/compare-three.jpg)
- 1440 × 820 下，剧本杀对话栏由 431 px 增至 820 px。四类作品的欢迎输入框顶部均为 390.5 px。打开剧本杀后，树选中对应真相稿。[真相页对照](2026-11-18-writing-workspace-parity/compare-truth.jpg)
- 深色角色页保留底牌标记，公开页与底牌在同一行切换。[深色对照](2026-11-18-writing-workspace-parity/compare-role.jpg)
- 1000 × 680、UI 24 px 下，浅色人物本、深色角色底牌可阅读，工具栏与保存页脚可见。[窄窗对照](2026-11-18-writing-workspace-parity/compare-compact.jpg)
- 左右互换后，对话栏展开时占满栏高，收起时编辑区使用余下宽度。[分栏对照](2026-11-18-writing-workspace-parity/compare-swapped.jpg)
- 提案进入消息区，点击文件可定位到角色和幕次。冲突窗口同时展示草稿与磁盘内容。11 组改后画面均无页面级横向溢出。[提案与冲突](2026-11-18-writing-workspace-parity/compare-review.jpg)
- 类型、边界、本地化、构建及渲染体积预算通过。会话存储和两种关闭时机的独立冒烟通过。[改前布局采样](2026-11-18-writing-workspace-parity/before.json) · [改后布局采样](2026-11-18-writing-workspace-parity/after.json)

## 未覆盖与后续

- `pnpm smoke` 的英文「更多功能」场景失败。当前默认显示 6 个入口，脚本要求至少 9 个。用改前 Renderer 单独执行相同的语言冒烟也复现该断言。
- 桌面画面与输入法事件在 macOS 验证。Windows 实机及在线模型生成未在本轮验证。提案使用合成事件，接受与撤销均走真实 Core 文件事务。
