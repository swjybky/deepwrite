# 学术写作

验证日期：2026-11-23（测试实例，CLI 驱动）。截图：[学术工作区](../../test/2026-11-23-feature-map/academic-workspace.png)、[提案冲突现场](../../test/2026-11-23-verify-cli-p4/academic-rerun-empty.png)。

## 1. 功能说明

学术写作用于论文类作品。新建时要选**子类型**（默认「实证 / 理工论文」，`empirical_paper`）和**引用格式**（默认 `gbt7714`）。

作品分三块：

- **研究底座**：研究立意与核心贡献、术语与符号表、文献与证据卡。
- **论证框架**：立题与文献脉络、方法与理论框架、实验与论据规划、全文论证大纲。
- **正文编写**：按章节组织，每节有「写作指引 / 正文 / 节末状态」三份文档。

智能体按节写作。证据卡不能虚构，缺数据的地方用 `[待补数据: …]` 占位。

## 2. 用户路径

1. **新建**：点「新建书籍」，选「学术写作」标签页，填书名，选子类型和引用格式，点「创建」。
2. **打开**：在左侧栏点开带「学术」标签的作品。作品下有三组：研究底座、论证框架、正文编写。
3. **编辑**：点文档进入编辑区。证据卡在「文献与证据卡」下维护；章节结构在正文编写下增删。

## 3. 前后端对应

**Renderer**

- 学术专用组件：`components/academic/`，以及
  - `AcademicFrameworkDialog.vue`
  - `AcademicManuscriptDialog.vue`
  - `AcademicReferenceCardDialog.vue`、`AcademicReferenceCardBar.vue`
  - `AcademicMaterialCardImportDialog.vue`
  - `AcademicWorkspaceDialogs.vue`
  - `ExportAcademicManuscriptDialog.vue`
- 会话：`composables/agent-conversation/academicConversationRuntime.ts`
- 提案：`composables/proposal-coordinator/academic-proposal-lane.ts`。提案带 `academicBaseProjectRevision`。

**Preload**（`preload/index.ts`）

| 用途 | 命令 |
| --- | --- |
| 建书 | `catalog.createAcademicBook` |
| 改框架 | `catalog.mutateAcademicFramework` |
| 改正文结构 | `catalog.mutateAcademicManuscript` |
| 证据卡增改删 | `catalog.createAcademicReferenceCard`、`catalog.updateAcademicReferenceCard`、`catalog.deleteAcademicReferenceCard` |
| 导出 | `manuscript.exportAcademic` |

**Core Utility**

- `utilities/folder-catalog-store.ts`
- `utilities/folder-catalog-store/academic-mutations.ts`

**智能体**

- 工具：`packages/pi-runtime-adapter/src/academic-agent-tools/`
- 默认学术团队有 5 个子智能体，可在「智能体团队」页启用。

**磁盘数据**

作品放在 `workspace/books/<书名>/`：

| 路径 | 内容 |
| --- | --- |
| `deepwrite.json` | 清单，含子类型和引用格式 |
| `foundation/` | 研究底座 |
| `framework/` | 论证框架，如 `problem_and_gap.md`、`method_framework.md`、`evidence_plan.md`、`argument_outline.md` |
| `manuscript/sections/` | 各节文档 |
| `.deepwrite/` | 内部数据 |

## 4. 用验证 CLI 驱动

**建作品并写来源：**

```bash
pnpm -s ctl app call manage_work --args '{"action":"create","type":"academic","title":"样例论文"}'
pnpm -s ctl app call get_work --args '{"workId":"<id>"}'      # 默认 27 份文档：摘要、1 引言 … 参考文献，每节三份
pnpm -s ctl ui open --work <id>
pnpm -s ctl ui click --role button --name 文献与证据卡
```

**智能体写作与回归：**

```bash
pnpm -s ctl agent scenario academic
pnpm -s ctl agent assert <runId> --saved --doc "3 方法设计 · 正文=[待补数据: 配对阅读时间]"
```

这个场景读研究立意，然后写「3 方法设计」的写作指引和正文；检查校验词、占位符，以及提案是否全部保存。

## 5. 注意事项

- **已知缺陷（2026-11-23，修复中）：连续修改同一节会丢写入。**
  - 现象：模型连续 edit 同一节的写作指引和正文后，两份提案都变成 `conflict`，文档实际为空。
  - 但写入工具回复「已提交自动保存」，`get_agent_run` 报 `completed`，日志也没有报错。
  - 根因方向：`academic-proposal-lane.ts` 的项目修订号冲突判定。
  - 在修好之前，学术写入一律加 `agent assert --saved` 并回读文档，不要只看回复。
- **节名带编号。** 节标题形如「3 方法设计 · 正文」。用 `--doc`、`--absent` 断言时，标题必须写全。
- **不虚构数据。** 场景要求不编造文献、参与者和结果，审阅模型输出时要检查这一点。
- **自定义子类型。** 新建时的子类型、引用格式在 `app tools manage_work` 里有完整取值；不传时用默认值。
