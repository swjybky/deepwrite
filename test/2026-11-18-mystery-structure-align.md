# 剧本杀结构与交互对齐

## 目标与成功标准

- 作品一级菜单与短篇、长篇共用顺序和标签。可操作作品支持结构、改名、复制、独立绑定、导出、移除和删除。不可用作品只提供移除。
- 结构管理支持盘面规格与四类条目增删改移。点击阶段显示概览，点击文稿打开正文并同步树定位。文稿标题和树去掉冗余标记。

## 环境

- macOS、Electron 42.5.0、隔离开发版和临时数据目录。截图使用合成作品「雾钟山庄」，交互使用其副本及合成素材库、技能库。
- 浅色和深色各验证 1440×900、14px 及 1000×680、24px。改前截取菜单、AGENTS.md 预览、展开的分幕目录，紧凑窗口补截 AGENTS.md。

## 步骤与命令

- L1 `pnpm exec vitest run mystery TreeNodeItem useWorkspaceResourceCoordinator BookResource BookLibrary BookAgentTeam LongStructure longStructure LongWorkspace.rollback-bindings-and-structure App.performance ManuscriptExport manuscript-export --reporter=default`。
- L1 改动文件 `pnpm exec eslint --max-warnings=0`、`pnpm exec prettier --check`，另跑 `pnpm lint:i18n`。
- L2 `pnpm typecheck`、`pnpm lint:boundary`。用 `pnpm --filter @deepwrite/desktop exec electron-vite build --outDir <临时目录>` 和仓库构建检查器验证预算。
- L2 启动前执行 `assertElectronLaunchAllowed()`。隔离 `pnpm dev` 中走真实点击、磁盘 API 与 Electron 截图。

## 结果

- **通过** 29 个 Vitest 文件、133 项测试，含剧本杀存储与 Markdown／Word 导出隔离。类型、多语言、边界和格式检查通过。
- **通过** 构建启动 JS 为 1,233,652 B，语言数据为 843,798 B。初检报 `Renderer application JavaScript exceeds its 1,235,000 B budget.`，统一三类菜单后复测通过。
- **通过** 17 组桌面检查。两类绑定分别保存，盘面支持校验和放弃，四类条目均可新增、上移、下移、改名、删除。验证了目录双向排序、三阶段文稿跳转、栏收起恢复、复制、注销保留文件、不可用项移除及副本删除。
- **通过** 浅／深色中一级菜单均完整，移除和删除在分隔线下。AGENTS.md 只显示正文已有标题，打开的分幕目录仍能定位同一篇文稿。
- **通过** 紧凑窗口里，AGENTS.md 预览只有一个标题，结构表单显示完整。分幕矩阵在栏内横向滚动并固定角色列，整窗无横向溢出。
- **通过** 浅／深色结构弹窗和矩阵共享主题。角色卡展示名称、身份标签和两篇文稿入口，线索列表包含公共序幕、各轮搜证和结局。
- [原始截图和对照图](2026-11-18-mystery-structure-align/)。`before/after` 为原图，`compare` 为对照图，均小于 1 MB。浅色、深色和紧凑窗口的对照图已发到对话。

## 未覆盖与后续

- 桌面操作验证到导出设置页，实际分册写入通过磁盘集成测试验证。未运行 Windows 安装包、真实模型和全量测试。
