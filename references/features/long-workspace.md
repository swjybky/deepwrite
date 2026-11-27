# 长篇工作台

验证日期：2026-11-23（测试实例，CLI 驱动）。截图：[工作台](../../test/2026-11-23-feature-map/long-workspace.png)、[新建分卷](../../test/2026-11-23-feature-map/long-new-volume.png)、[新建小节](../../test/2026-11-23-feature-map/long-new-chapter.png)。

## 1. 功能说明

长篇作品的结构比短篇多一层，按五部分组织：

- 世界观：规则、势力、地理、历史、术语、境界、物品，以及世界观揭露。
- 人物设计。
- 剧情设计：全书主线、分卷、剧情点。
- 正文：分卷 → 章节。每章有五份文档：正文、章卡、人物状态、交接、伏笔变化。
- 连续性账本。

智能体按章写作，写完一章要提交连续性（`propose_continuity_commit`）。长篇的改动按文件批次提交，可以撤回。

## 2. 用户路径

1. 左侧栏「创作空间」，点开一部长篇（带「长篇」标签）。树下依次是：世界观、人物设计、剧情设计、正文、连续性账本。
2. 新建分卷：「正文」行右侧的 `+`（按钮名「在正文新增条目」）→「新建分卷」弹窗，填分卷名称、卷纲，点「确认新建」。
3. 新建章节：展开分卷，点分卷行右侧的 `+`（按钮名「在<卷名>新增小节」）→「新建小节」弹窗，填小节名称，可选关联剧情点，点「确认新建」。
4. 点章节进入编辑区写正文；对话区可以让长篇智能体按章写作。

## 3. 前后端对应

**Renderer**

- 编辑器：`components/LongManuscriptEditor.vue`
- 弹窗：`CreateLongVolumeDialog.vue`、`CreateLongChapterCardDialog.vue`、`CreateLongCharacterDialog.vue`、`CreateLongPlotPointDialog.vue`、`CreateLongWorldbuildingItemDialog.vue`
- 连续性：`LongContinuityLedgerNavigation.vue`、`LongForeshadowingWorkspace.vue`
- 提案审阅：`LongProposalReview.vue`
- 生命周期与会话：`composables/useLongBookLifecycleCoordinator.ts`、`useLongConversationCoordinator.ts`、`useLongProposalRuntimeCoordinator.ts`
- 提案批次：`composables/proposal-coordinator/long-file-proposal-batches.ts`、`long-impact-approval.ts`、`long-stale-base.ts`

**Preload**（`preload/long-api.ts`、`long-document-api.ts`、`long-book-api.ts`）主要命令：

| 用途 | 命令 |
| --- | --- |
| 建书与打开 | `long.createBook`、`long.open`、`long.list` |
| 读结构 | `long.getWorkspaceIndex` |
| 读写文档 | `long.readDocument`、`long.writeDocument`、`long.writeChapter` |
| 提交章节与连续性 | `long.commitChapter` |
| 结构操作 | `long.previewOperations`、`long.applyOperations`、`long.restoreOperations` |
| 搜索 | `long.search` |
| 改绑定 | `long.updateBindings` |

**Main 与 Core Utility**

Main 把 `long.*` 转给 Core 处理：

- `utilities/long-project-store.ts`：唯一写入者，带事务与还原点
- `long-workspace-service.ts`、`long-core-commands.ts`、`long-project-catalog.ts`
- 事务：`utilities/project-transaction.ts`

**智能体**

- 长篇工具：`packages/pi-runtime-adapter/src/long-agent-tools/`
- 提示词：`prompts-long*.ts`

**磁盘数据**

作品在 `workspace/books/<书名>/`，目录如下：

| 路径 | 内容 |
| --- | --- |
| `deepwrite.json` | 作品元信息 |
| `AGENTS.md` | 作品级说明 |
| `long/index.json` | 结构索引 |
| `long/worldbuilding/<类别>/` | 世界观条目 |
| `long/characters/overview.md` | 人物概览 |
| `long/plot/book-line.md` | 全书主线 |
| `long/chapters/<哈希>/` | 每章一个目录：`body.md`、章卡等 |
| `long/continuity/chapters/` | 连续性账本 |
| `.deepwrite/transactions/` | 事务记录 |

注册表：`profile/long-project-registry.json`。

## 4. 用验证 CLI 驱动

**界面：新建分卷与章节**

```bash
pnpm -s ctl data load long                                 # 一部长篇《灯盐录》，第一章有正文与章卡
pnpm -s ctl ui open --work <长篇id>
pnpm -s ctl logs mark --name before-long
pnpm -s ctl ui click --label 选择并展开正文 --nth 0
pnpm -s ctl ui click --label 在正文新增条目                 # 弹出「新建分卷」
pnpm -s ctl ui press Escape
pnpm -s ctl ui click --label 展开第一卷
pnpm -s ctl ui click --label 在第一卷新增小节
pnpm -s ctl ui fill --label 小节名称 --value 第二章
pnpm -s ctl ui click --role button --name 确认新建
pnpm -s ctl ui wait --role dialog --gone
```

**核对**

```bash
pnpm -s ctl app call get_work --args '{"workId":"<长篇id>"}'    # 多出「第二章 · 正文 / 章卡 / 人物状态 / 交接 / 伏笔变化」
pnpm -s ctl logs errors --since before-long
```

**智能体按章写作**

```bash
pnpm -s ctl agent scenario long                              # 读主线、写第一章章卡与正文、断言校验词与提案
```

## 5. 注意事项

- **控制接口不能改长篇结构。** `manage_document` 拒绝长篇，加章节只能走界面或长篇智能体；`write_document` 只能写已有文档。
- **章节目录名不可读。** 章节目录用哈希命名（`long/chapters/<哈希>/`），不能按章名拼路径，按 `get_work` 返回的文档 id 读写。
- **同一章的标题可能对不上。** `read_document` 对长篇返回的 title 是文件路径，`get_work` 返回的是界面标题。这个问题已交给修复线程处理。
- **新建分卷弹窗里有同名「第一卷」。** 默认已有「第一卷」，弹窗里也可能出现同名文字；定位用 `--label` 或 `--role`，不要只用 `--text 第一卷`。
- **长篇写作耗时更长。** 场景单次约 50 秒。连续性提交失败时，看 `agent trace` 里 `propose_continuity_commit` 的参数和结果。
