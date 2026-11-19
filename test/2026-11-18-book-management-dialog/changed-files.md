# 作品管理弹窗改动文件

路径相对仓库根目录。

## 修改

- `apps/desktop/src/renderer/src/components/BookResourceDialog.vue`　统一管理内改名的叠层外观。
- `apps/desktop/src/renderer/src/components/LongBookRenameDialog.vue`　支持在长篇管理上层显示改名。
- `apps/desktop/src/renderer/src/components/LongLegacySyncDialog.vue`　支持旧版本预览叠层及首次打开时的焦点。
- `apps/desktop/src/renderer/src/components/LongStructureDeleteDialog.vue`　复用二级外壳和全局按钮，保留删除影响确认。
- `apps/desktop/src/renderer/src/components/LongStructureDialog.vue`　合并长篇结构面板，拆平分区，保留两项作品操作。
- `apps/desktop/src/renderer/src/components/LongWorkspace.rollback-bindings-and-structure.test.ts`　移除依赖旧长篇模板字符串的断言。
- `apps/desktop/src/renderer/src/components/LongWorkspace.test-support.ts`　移除对已删除组件的源码导入。
- `apps/desktop/src/renderer/src/components/LongWorldbuildingSyncDialog.vue`　复用二级外壳，保留来源选择和覆盖影响确认。
- `apps/desktop/src/renderer/src/components/PlotStructureDialog.vue`　给短篇和剧本接入共享外壳、条目与二级弹窗。
- `apps/desktop/src/renderer/src/components/SaveConflictDialog.vue`　管理内冲突弹窗使用统一叠层与 Esc。
- `apps/desktop/src/renderer/src/components/WorkspaceDialogLayer.types.ts`　给管理描述符增加改名和旧版本预览状态。
- `apps/desktop/src/renderer/src/components/WorkspaceDialogLayer.vue`　在原管理窗口中打开改名与旧版本预览。
- `apps/desktop/src/renderer/src/components/WritingContextPanel.vue`　统一五类上下文的编辑、字数和保存位置。
- `apps/desktop/src/renderer/src/components/academic/AcademicFrameworkDialog.vue`　接入共享外壳，阶段编辑和删除改为二级弹窗。
- `apps/desktop/src/renderer/src/components/academic/academicLabels.ts`　更新学术分区、说明和删除确认的双语文案。
- `apps/desktop/src/renderer/src/components/usePlotStructureDialog.ts`　移除各自的焦点处理，保留剧情变更和分区切换逻辑。
- `apps/desktop/src/renderer/src/composables/useLazyShortBookLifecycleCoordinator.ts`　向学术管理提供已有改名弹窗的打开状态。
- `apps/desktop/src/renderer/src/composables/useLongStructureDeleteConfirmation.ts`　管理结构加载时接受空快照。
- `apps/desktop/src/renderer/src/composables/useWorkspaceDialogModuleCoordinator.test.ts`　验证改名与旧版本预览继续渲染原管理描述符。
- `apps/desktop/src/renderer/src/composables/useWorkspaceDialogModuleCoordinator.ts`　沿用既有对话框状态，将管理内动作投影为二级弹窗。
- `apps/desktop/src/renderer/src/features/mystery/MysteryDialogs.vue`　管理内弹窗使用相同遮罩层级。
- `apps/desktop/src/renderer/src/features/mystery/MysteryStructureManager.vue`　把盘面、各集合及上下文接入共享管理分区。
- `apps/desktop/src/renderer/src/features/mystery/MysteryWorkspaceModule.vue`　直接打开剧本杀管理组件并传递其子弹窗状态。
- `apps/desktop/src/renderer/src/features/mystery/messages.ts`　补充盘面和集合分区的双语名称与说明。
- `apps/desktop/src/renderer/src/i18n/messages/components/en-US.ts`　移除旧长篇外壳文案目录。
- `apps/desktop/src/renderer/src/i18n/messages/components/longStructureManager/en-US.ts`　更新长篇分区与加载提示，精简废弃文案。
- `apps/desktop/src/renderer/src/i18n/messages/components/longStructureManager/zh-CN.ts`　更新长篇分区与加载提示，精简废弃文案。
- `apps/desktop/src/renderer/src/i18n/messages/components/plotStructureDialog/en-US.ts`　补充共享分组和管理标题，删除不用的文案。
- `apps/desktop/src/renderer/src/i18n/messages/components/plotStructureDialog/zh-CN.ts`　补充共享分组和管理标题，删除不用的文案。
- `apps/desktop/src/renderer/src/i18n/messages/components/writingContextPanel/en-US.ts`　补齐小说与学术上下文文案和重读状态。
- `apps/desktop/src/renderer/src/i18n/messages/components/writingContextPanel/zh-CN.ts`　补齐小说与学术上下文文案和重读状态。
- `apps/desktop/src/renderer/src/i18n/messages/components/zh-CN.ts`　移除旧长篇外壳文案目录。
- `apps/desktop/src/renderer/src/stores/academicWorkspaceDialog.ts`　补充学术流程对改名打开状态的查询。
- `design/dialogs.md`　记录固定尺寸、共用分区配置和二级窗行为。
- `TEST.md`　登记本轮验证。

## 新增

- `apps/desktop/src/renderer/src/components/book-management/BookManagementChildDialog.vue`　共用的新增、编辑和危险确认外壳。
- `apps/desktop/src/renderer/src/components/book-management/BookManagementDialog.vue`　固定尺寸外壳、分组导航、焦点和键盘行为。
- `apps/desktop/src/renderer/src/components/book-management/BookManagementRowActions.vue`　共用排序、编辑和删除按钮。
- `apps/desktop/src/renderer/src/components/book-management/book-management.css`　外壳、列表、设置行和叠层样式。
- `test/2026-11-18-book-management-dialog.md`　本轮验证报告。
- `test/2026-11-18-book-management-dialog/changed-files.md`　本清单。
- `test/2026-11-18-book-management-dialog/before-dimensions.json`　基线尺寸。
- `test/2026-11-18-book-management-dialog/after-dimensions.json`　五类与各分区在五组视口、字号及主题下的尺寸与子窗口测量。
- `test/2026-11-18-book-management-dialog/interactions.json`　Electron 探针操作结果。
- `test/2026-11-18-book-management-dialog/before-light-1200x850-short-structure.png`　短篇结构 · 改前。
- `test/2026-11-18-book-management-dialog/after-light-1200x850-short-structure.png`　短篇结构 · 改后。
- `test/2026-11-18-book-management-dialog/before-light-1200x850-short-context.png`　短篇上下文 · 改前。
- `test/2026-11-18-book-management-dialog/after-light-1200x850-short-context.png`　短篇上下文 · 改后。
- `test/2026-11-18-book-management-dialog/before-light-1200x850-script-structure.png`　剧本结构 · 改前。
- `test/2026-11-18-book-management-dialog/after-light-1200x850-script-structure.png`　剧本结构 · 改后。
- `test/2026-11-18-book-management-dialog/before-light-1200x850-script-context.png`　剧本上下文 · 改前。
- `test/2026-11-18-book-management-dialog/after-light-1200x850-script-context.png`　剧本上下文 · 改后。
- `test/2026-11-18-book-management-dialog/before-light-1200x850-long-structure.png`　长篇结构 · 改前。
- `test/2026-11-18-book-management-dialog/after-light-1200x850-long-structure.png`　长篇结构 · 改后。
- `test/2026-11-18-book-management-dialog/before-light-1200x850-long-context.png`　小说上下文 · 改前。
- `test/2026-11-18-book-management-dialog/after-light-1200x850-long-context.png`　小说上下文 · 改后。
- `test/2026-11-18-book-management-dialog/before-light-1200x850-mystery-structure.png`　剧本杀集合 · 改前。
- `test/2026-11-18-book-management-dialog/after-light-1200x850-mystery-structure.png`　剧本杀集合 · 改后。
- `test/2026-11-18-book-management-dialog/before-light-1200x850-mystery-context.png`　剧本杀上下文 · 改前。
- `test/2026-11-18-book-management-dialog/after-light-1200x850-mystery-context.png`　剧本杀上下文 · 改后。
- `test/2026-11-18-book-management-dialog/before-light-1200x850-academic-structure.png`　学术框架 · 改前。
- `test/2026-11-18-book-management-dialog/after-light-1200x850-academic-structure.png`　学术框架 · 改后。
- `test/2026-11-18-book-management-dialog/before-light-1200x850-academic-context.png`　学术上下文 · 改前。
- `test/2026-11-18-book-management-dialog/after-light-1200x850-academic-context.png`　学术上下文 · 改后。
- `test/2026-11-18-book-management-dialog/before-dark-1200x850-14-structure.png`　深色 · 长篇 · 改前。
- `test/2026-11-18-book-management-dialog/after-dark-1200x850-14-structure.png`　深色 · 长篇 · 改后。
- `test/2026-11-18-book-management-dialog/before-light-1000x680-14-context.png`　1000×680 · 长篇 · 改前。
- `test/2026-11-18-book-management-dialog/after-light-1000x680-14-context.png`　1000×680 · 长篇 · 改后。
- `test/2026-11-18-book-management-dialog/before-light-1000x680-24-structure.png`　24px · 长篇 · 改前。
- `test/2026-11-18-book-management-dialog/after-light-1000x680-24-structure.png`　24px · 长篇 · 改后。
- `test/2026-11-18-book-management-dialog/before-light-1200x850-10-context.png`　10px · 长篇 · 改前。
- `test/2026-11-18-book-management-dialog/after-light-1200x850-10-context.png`　10px · 长篇 · 改后。
- `test/2026-11-18-book-management-dialog/before-light-1200x850-14-child.png`　短篇新建子弹窗 · 改前。
- `test/2026-11-18-book-management-dialog/after-light-1200x850-14-child.png`　短篇新建子弹窗 · 改后。

## 删除

- `apps/desktop/src/renderer/src/components/LongStructureManager.vue`　结构内容并入长篇管理组件。
- `apps/desktop/src/renderer/src/components/plot-structure-dialog.css`　旧短篇与剧本管理样式由共享样式替代。
- `apps/desktop/src/renderer/src/i18n/messages/components/longStructureDialog/en-US.ts`　旧长篇外壳英文文案。
- `apps/desktop/src/renderer/src/i18n/messages/components/longStructureDialog/zh-CN.ts`　旧长篇外壳中文文案。
