# 书籍菜单与绑定弹窗改动文件

## 新增

- [components/BookActionMenu.vue](../../apps/desktop/src/renderer/src/components/BookActionMenu.vue)。集中渲染五类作品的菜单项、分隔线和危险样式。
- [components/BookBindingsDialog.vue](../../apps/desktop/src/renderer/src/components/BookBindingsDialog.vue)。提供三个选项卡、独立草稿、批量保存、部分失败重试和放弃确认。
- [components/BookBindingsDialog.test.ts](../../apps/desktop/src/renderer/src/components/BookBindingsDialog.test.ts)。用渲染组件验证选项卡选择保留、保存禁用与部分失败重试。
- [components/BookManagementName.vue](../../apps/desktop/src/renderer/src/components/BookManagementName.vue)。提供现有管理弹窗共用的作品名称行和重命名按钮。
- [stores/bookBindingsDialog.ts](../../apps/desktop/src/renderer/src/stores/bookBindingsDialog.ts)。定义统一绑定弹窗目标和写入回调。
- [vueClientRender.mjs](../../apps/desktop/src/test-utils/vueClientRender.mjs)。在 Node 测试中编译实际 Vue 模板供行为测试挂载。
- [vueClientRender.d.mts](../../apps/desktop/src/test-utils/vueClientRender.d.mts)。将测试模板编译器的类型约束在 Vue 渲染函数边界。
- [验证报告](../2026-11-18-book-menu-bindings.md)。记录命令、预算、截图及未覆盖项。
- [截图目录](.)。保存改前、改后单帧和带标题的对照图。

## 修改

- [App.performance.test.ts](../../apps/desktop/src/renderer/src/App.performance.test.ts)。移除对已退役的单独保存函数的源码断言，保留工作台预算检查。
- [WorkspaceShell.vue](../../apps/desktop/src/renderer/src/WorkspaceShell.vue)。挂载惰性绑定弹窗，路由管理动作并删除旧绑定装配。
- [components/BookResourceDialog.vue](../../apps/desktop/src/renderer/src/components/BookResourceDialog.vue)。保留重命名和移除／删除确认，清理旧库绑定分支。
- [components/LeftSidebar.vue](../../apps/desktop/src/renderer/src/components/LeftSidebar.vue)。移除旧团队绑定弹窗的侧栏挂载点。
- [components/LongStructureDialog.vue](../../apps/desktop/src/renderer/src/components/LongStructureDialog.vue)。添加作品名称行和长篇维护区，并让冲突修复可绕开受阻的上下文保存。
- [components/LongWorkspace.rollback-bindings-and-structure.test.ts](../../apps/desktop/src/renderer/src/components/LongWorkspace.rollback-bindings-and-structure.test.ts)。移除退役长篇绑定界面的源码断言，由生命周期行为测试覆盖写入。
- [components/LongWorkspace.test-support.ts](../../apps/desktop/src/renderer/src/components/LongWorkspace.test-support.ts)。移除旧长篇绑定组件的测试支持引用。
- [components/PlotStructureDialog.vue](../../apps/desktop/src/renderer/src/components/PlotStructureDialog.vue)。在短篇和剧本的结构管理中显示作品名称行，刷新写作上下文后打开重命名。
- [components/SidebarResourceList.vue](../../apps/desktop/src/renderer/src/components/SidebarResourceList.vue)。恢复分批目录加载的置顶顺序，仅将已匹配且可用的置顶节点移出原列表。
- [components/TreeNodeItem.test.ts](../../apps/desktop/src/renderer/src/components/TreeNodeItem.test.ts)。验证中英文菜单、置顶文案、删除颜色与不可用状态。
- [components/TreeNodeItem.vue](../../apps/desktop/src/renderer/src/components/TreeNodeItem.vue)。让五类作品使用统一菜单和原有业务动作路由。
- [components/TreeSection.vue](../../apps/desktop/src/renderer/src/components/TreeSection.vue)。通过共用节点条件向树项传递置顶能力。
- [components/WorkspaceDialogLayer.test.ts](../../apps/desktop/src/renderer/src/components/WorkspaceDialogLayer.test.ts)。更新剩余工作台弹窗类型覆盖。
- [components/WorkspaceDialogLayer.types.ts](../../apps/desktop/src/renderer/src/components/WorkspaceDialogLayer.types.ts)。删除旧绑定弹窗描述和事件，新增管理动作事件。
- [components/WorkspaceDialogLayer.vue](../../apps/desktop/src/renderer/src/components/WorkspaceDialogLayer.vue)。连接管理弹窗与重命名、同步旧版本和解决冲突流程。
- [components/academic/AcademicFrameworkDialog.vue](../../apps/desktop/src/renderer/src/components/academic/AcademicFrameworkDialog.vue)。在论证框架管理中显示作品名称行，并转入现有重命名。
- [components/lazyAppComponents.ts](../../apps/desktop/src/renderer/src/components/lazyAppComponents.ts)。声明新绑定弹窗的惰性组件并删除旧入口。
- [components/lazyFeatureImports.ts](../../apps/desktop/src/renderer/src/components/lazyFeatureImports.ts)。替换绑定弹窗的动态导入。
- [components/plot-structure-dialog.css](../../apps/desktop/src/renderer/src/components/plot-structure-dialog.css)。在结构管理网格中为名称行保留一行。
- [components/usePlotStructureDialog.ts](../../apps/desktop/src/renderer/src/components/usePlotStructureDialog.ts)。复用管理弹窗已有的写作上下文保存和重命名事件类型。
- [composables/longBookLifecycleTypes.ts](../../apps/desktop/src/renderer/src/composables/longBookLifecycleTypes.ts)。删除旧长篇绑定弹窗的模式和独立提交类型。
- [composables/useLazyLongBookLifecycleCoordinator.test.ts](../../apps/desktop/src/renderer/src/composables/useLazyLongBookLifecycleCoordinator.test.ts)。更新长篇生命周期模拟接口。
- [composables/useLazyLongBookLifecycleCoordinator.ts](../../apps/desktop/src/renderer/src/composables/useLazyLongBookLifecycleCoordinator.ts)。移除废弃的单独绑定弹窗操作转发。
- [composables/useLazyShortBookLifecycleCoordinator.test.ts](../../apps/desktop/src/renderer/src/composables/useLazyShortBookLifecycleCoordinator.test.ts)。让短篇生命周期模拟覆盖新的绑定入口。
- [composables/useLazyShortBookLifecycleCoordinator.ts](../../apps/desktop/src/renderer/src/composables/useLazyShortBookLifecycleCoordinator.ts)。路由短篇类绑定入口并将学术重命名接回现有生命周期。
- [composables/useLongBookLifecycleCoordinator.test.ts](../../apps/desktop/src/renderer/src/composables/useLongBookLifecycleCoordinator.test.ts)。核对长篇绑定刷新与另一类绑定保留，并覆盖编辑器保存受阻时的管理入口。
- [composables/useLongBookLifecycleCoordinator.ts](../../apps/desktop/src/renderer/src/composables/useLongBookLifecycleCoordinator.ts)。复用长篇绑定更新命令和阶段范围，允许在有索引的当前长篇里进入管理处理冲突。
- [composables/useShortBookLifecycleCoordinator.test.ts](../../apps/desktop/src/renderer/src/composables/useShortBookLifecycleCoordinator.test.ts)。核对短篇绑定的旧作品兼容和旧请求完成时保留新弹窗。
- [composables/useShortBookLifecycleCoordinator.ts](../../apps/desktop/src/renderer/src/composables/useShortBookLifecycleCoordinator.ts)。为统一弹窗提供短篇、剧本和学术绑定保存，复用作品版本检查和更新流程。
- [composables/useWorkspaceDialogModuleCoordinator.test.ts](../../apps/desktop/src/renderer/src/composables/useWorkspaceDialogModuleCoordinator.test.ts)。同步弹窗优先级及不再需要的库目录输入。
- [composables/useWorkspaceDialogModuleCoordinator.ts](../../apps/desktop/src/renderer/src/composables/useWorkspaceDialogModuleCoordinator.ts)。停止生成旧绑定弹窗和过时的库目录数据。
- [features/mystery/MysteryDialogs.vue](../../apps/desktop/src/renderer/src/features/mystery/MysteryDialogs.vue)。删除单项库绑定模式并处理管理弹窗内重命名的弹窗层级。
- [features/mystery/MysteryTreeNodeMenuItems.vue](../../apps/desktop/src/renderer/src/features/mystery/MysteryTreeNodeMenuItems.vue)。保留剧本杀结构子节点菜单，书籍菜单改由公共组件渲染。
- [features/mystery/MysteryUnavailableRemoval.vue](../../apps/desktop/src/renderer/src/features/mystery/MysteryUnavailableRemoval.vue)。更新共用移除确认的入参以移除旧库目录数据。
- [features/mystery/MysteryWorkspaceModule.vue](../../apps/desktop/src/renderer/src/features/mystery/MysteryWorkspaceModule.vue)。在剧本杀管理中接入原重命名，复用现有绑定写入流程并返回保存结果。
- [stores/academicWorkspaceDialog.ts](../../apps/desktop/src/renderer/src/stores/academicWorkspaceDialog.ts)。为论证框架管理提供现有学术重命名入口。
- [stores/longWorkspaceStore.ts](../../apps/desktop/src/renderer/src/stores/longWorkspaceStore.ts)。删除退役的长篇绑定弹窗模式状态。
- [types/longBookAction.ts](../../apps/desktop/src/renderer/src/types/longBookAction.ts)。用统一绑定动作替换两个独立库动作。
- [types/workspace.ts](../../apps/desktop/src/renderer/src/types/workspace.ts)。同步短篇类生命周期的统一绑定模式。
- [utils/pinnedResources.test.ts](../../apps/desktop/src/renderer/src/utils/pinnedResources.test.ts)。覆盖长篇和剧本杀置顶在目录分批加载后的恢复和不可用过滤。
- [utils/pinnedResources.ts](../../apps/desktop/src/renderer/src/utils/pinnedResources.ts)。共享置顶节点资格判断并按保存顺序恢复可用节点。
- [i18n/messages/components/bookAgentTeamBindings/zh-CN.ts](../../apps/desktop/src/renderer/src/i18n/messages/components/bookAgentTeamBindings/zh-CN.ts)。简体中文补充标签、未保存状态和保存反馈文案。
- [i18n/messages/components/bookResourceDialog/zh-CN.ts](../../apps/desktop/src/renderer/src/i18n/messages/components/bookResourceDialog/zh-CN.ts)。简体中文删除独立库绑定弹窗专用文案。
- [i18n/messages/components/longBookActionMenu/zh-CN.ts](../../apps/desktop/src/renderer/src/i18n/messages/components/longBookActionMenu/zh-CN.ts)。简体中文提供统一菜单和作品名称文案。
- [i18n/messages/components/treeNodeItem/zh-CN.ts](../../apps/desktop/src/renderer/src/i18n/messages/components/treeNodeItem/zh-CN.ts)。简体中文去掉旧的分类型菜单文案。
- [i18n/messages/components/zh-CN.ts](../../apps/desktop/src/renderer/src/i18n/messages/components/zh-CN.ts)。简体中文移除旧长篇库绑定词条导入。
- [i18n/messages/workspace/zh-CN-catalog.ts](../../apps/desktop/src/renderer/src/i18n/messages/workspace/zh-CN-catalog.ts)。简体中文绑定版本冲突提示引导重新打开弹窗。
- [i18n/messages/components/bookAgentTeamBindings/en-US.ts](../../apps/desktop/src/renderer/src/i18n/messages/components/bookAgentTeamBindings/en-US.ts)。英文补充标签、未保存状态和保存反馈文案。
- [i18n/messages/components/bookResourceDialog/en-US.ts](../../apps/desktop/src/renderer/src/i18n/messages/components/bookResourceDialog/en-US.ts)。英文删除独立库绑定弹窗专用文案。
- [i18n/messages/components/longBookActionMenu/en-US.ts](../../apps/desktop/src/renderer/src/i18n/messages/components/longBookActionMenu/en-US.ts)。英文提供统一菜单和作品名称文案。
- [i18n/messages/components/treeNodeItem/en-US.ts](../../apps/desktop/src/renderer/src/i18n/messages/components/treeNodeItem/en-US.ts)。英文去掉旧的分类型菜单文案。
- [i18n/messages/components/en-US.ts](../../apps/desktop/src/renderer/src/i18n/messages/components/en-US.ts)。英文移除旧长篇库绑定词条导入。
- [i18n/messages/workspace/en-US-catalog.ts](../../apps/desktop/src/renderer/src/i18n/messages/workspace/en-US-catalog.ts)。英文绑定版本冲突提示引导重新打开弹窗。
- [TEST.md](../../TEST.md)。登记本轮验证结论。

## 删除

- `components/BookAgentTeamDialog.vue`。原独立团队绑定弹窗由统一弹窗接替。
- `components/LongBookActionMenu.vue`。原分文体菜单由通用书籍菜单接替。
- `components/LongBookBindingsDialog.vue`。原长篇单库弹窗由统一弹窗接替。
- `composables/useBookResourceBindings.ts`。短篇单库选择逻辑由共享库选择器接替。
- `composables/useBookResourceBindings.test.ts`。删除仅用于已退役单库选择器的测试。
- `stores/bookAgentTeamBindingDialog.ts`。原团队绑定目标状态迁入统一弹窗状态。
- `i18n/messages/components/longBookBindingsDialog/en-US.ts`。移除已退役长篇单库弹窗的英文词条。
- `i18n/messages/components/longBookBindingsDialog/zh-CN.ts`。移除已退役长篇单库弹窗的简体中文词条。
