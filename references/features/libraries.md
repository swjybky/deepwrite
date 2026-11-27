# 素材库与技能库

验证日期：2026-11-23（测试实例，CLI 全程驱动）。截图：[新建素材库弹窗](../../test/2026-11-23-feature-map/library-create-dialog.png)、[绑定弹窗](../../test/2026-11-23-feature-map/library-binding-dialog.png)、[打开素材库](../../test/2026-11-23-feature-map/library-open.png)。

## 1. 功能说明

资料库分两种：

- **素材库**：人物、设定、案例等参考资料。
- **技能库**：写作方法、风格要求等可加载的技能。

每个库都是工作目录下的一个文件夹，条目是 Markdown 文件。

- **内置基础长篇资源**：出厂自带只读的「基础长篇」素材分组（含取名素材库、优秀正文片段库、剧情推动设计素材库）和「基础长篇团队操作技能库」，默认展示在侧栏并带「内置」标签，不支持直接改名、增删改条目、移组或删除。可以通过右键/操作菜单中的「复制」复制到用户工作目录后自由定制。

库绑定到作品后，该作品的智能体有两种用法：

- 查素材：`query_linked_material_entries`。
- 加载技能：`load_skill`，或在输入框用 `/` 调用技能、用 `@` 引用素材。

单独打开一个库时，对话区换成资料库智能体，可以整理这个库的条目。

## 2. 用户路径

1. **新建库**
   1. 左侧栏「素材库」或「技能库」右侧点 `+`（按钮名「素材库新建或导入」「技能库新建或导入」）。菜单有六项：新增条目、新建素材库、新建分组、打开已存在素材库、导入素材包…、从文件或文件夹导入素材。
   2. 选「新建素材库」，在弹窗里填库名称、选分类，点「创建素材库」。
   3. 分类可选：文献、数据、设定、案例、其他、人设（修复前叫「人物」）、脑洞、剧情、正文、自定义标签…。
2. **查看与编辑**：在左侧栏点开库，条目列在库下面；点条目在右侧编辑区编辑。对话区顶部会显示「当前：<库名>」「阶段：素材库」。
3. **绑定到作品**
   1. 作品行右侧「…」（按钮名「<书名>更多操作」）→「绑定」，打开绑定弹窗。
   2. 弹窗有三个页签：技能库、素材库、团队。
   3. 勾选要绑定的库，点「保存」。

## 3. 前后端对应

**Renderer**

- 新建库：`components/LibraryProjectDialog.vue`，配合 `composables/useLibraryProjectDialog.ts`、`libraryProjectPreparation.ts`。
- 绑定：`components/BookBindingsDialog.vue`、`BookLibraryBindings.vue`、`BookBindingsPicker.vue`，配合 `composables/useBookLibrarySelection.ts`。
- 保存绑定：短篇和学术分别经 `useShortBookLifecycleCoordinator.ts`、`useAcademicBookLifecycleCoordinator.ts` 调 `catalog.updateBook`。
- 条目整理：`LibraryEntryMoveDialog.vue`、`LibraryEntryOrganizationMenu.vue`、`LibraryGroupDialog.vue`。
- 智能体提议的条目改动：在 `useProposalCoordinator.ts`（`createLibraryProposalStager`）和 `proposal-coordinator/library-staging.ts` 里处理，落盘调用 `catalog.saveLibraryEntry`、`createLibraryEntry`、`updateLibrary`。

**Preload 与契约命令**（`preload/index.ts`）

| 操作 | 命令 |
| --- | --- |
| 新建库 | `catalog.createLibrary` |
| 新建分组 | `catalog.createLibraryGroup` |
| 新增条目 | `catalog.createLibraryEntry` |
| 保存条目 | `catalog.saveLibraryEntry` |
| 改库信息 | `catalog.updateLibrary` |
| 改绑定 | `catalog.updateBook` |

**Main 与 Core Utility**

- Main 把 `catalog.*` 转给 Core。
- 库与条目：`utilities/folder-catalog-store.ts`（条目读写都在这个文件里）。
- 作品引用：`folder-catalog-store/book-library-references.ts`。
- 管理服务：`utilities/library-management-service.ts`。
- 素材查询：`utilities/material-query-service.ts`。

**智能体侧**（`packages/pi-runtime-adapter/src/`）

- 素材目录与查询工具：`material-catalog.ts`。
- 资料库智能体：`library-agent-tools.ts`，含 `load_skill`。
- 相关提示词：`prompts-material.ts`。

**磁盘数据**（测试实例在 `~/.deepwrite-test/default/`）

- 素材库在 `workspace/materials/<库名>/`：
  - `deepwrite.json`：`kind: deepwrite.material-library`、`materialKind`（如 `character`、`other`）、`customTag`、`entries[]`（id、title、path）。
  - `entries/<条目id>.md`：条目正文。
- 技能库在 `workspace/skills/<库名>/`，结构相同。
- 绑定写在**作品**的 `deepwrite.json` 里：
  - 素材库按分类分组：`linkedMaterialIdsByKind`，如 `{"character": ["material-…"]}`。
  - 技能库：`linkedSkillIdsByKind`。
  - 团队绑定不在这里，存在本机配置。
- 注册表：`profile/catalog-registry.json`。

## 4. 用验证 CLI 驱动

**界面路径：新建素材库**

```bash
pnpm -s ctl logs mark --name before-library
pnpm -s ctl ui click --label 素材库新建或导入
pnpm -s ctl ui click --role menuitem --name 新建素材库
pnpm -s ctl ui fill --label 素材库名称 --value 样例人物库
pnpm -s ctl ui select --label 素材库分类 --option 人设      # 选项名见上；写错会报 ui.no_option 并列出可选项
pnpm -s ctl ui screenshot --role dialog --out test/<日期-主题>/library-create.png
pnpm -s ctl ui click --role button --name 创建素材库
pnpm -s ctl data list                                       # libraries 里有新库，kind=character
```

**界面路径：绑定到作品**

```bash
pnpm -s ctl ui hover --text <书名> --nth 0                 # 让「…」出现；--nth 0 是侧栏那一行
pnpm -s ctl ui click --label <书名>更多操作
pnpm -s ctl ui click --role menuitem --name 绑定
pnpm -s ctl ui click --role button --name 素材库            # 切页签；默认在技能库
pnpm -s ctl ui click --text <库名>                          # 勾选这一行
pnpm -s ctl ui click --role button --name 保存
pnpm -s ctl app call get_work --args '{"workId":"<作品id>"}'   # linkedMaterialLibraryIds 含库 id
pnpm -s ctl logs errors --since before-library
```

**接口路径**：只需要数据、不验界面时用。

```bash
pnpm -s ctl data load libraries          # 一个人物素材库（3 条）+ 一个技能库（2 条）
pnpm -s ctl app call manage_library --args '{"action":"create","domain":"material","title":"样例","kind":"character"}'
pnpm -s ctl app call manage_entry --args '{"action":"create","libraryId":"<库id>","title":"沈砚","content":"灯塔看守人。"}'
pnpm -s ctl ui open --library <库id>     # 在窗口里打开库
```

**验证智能体用到了库**：作品绑定库后，让智能体查一个只在库里出现的词，看工具调用里有没有 `query_linked_material_entries`。

```bash
pnpm -s ctl agent run --work <作品id> --new --mode normal --message "查一下素材库里关于沈砚的设定，用一句话概括。"
pnpm -s ctl agent trace <runId>          # 或 agent trace --work <作品id>
```

实测：智能体调用了一次 `query_linked_material_entries`（`mode: read`），读到绑定库里的「沈砚」条目，没有改动文档。

## 5. 注意事项

- **分类叫法（2026-11-23 修复中）。** 原来侧栏标签显示「人设」，新建弹窗的选项叫「人物」。修复线程已把选项统一成「人设」，尚未提交；写命令前先看 `ui.no_option` 返回的可选项。
- **默认分类不是 `other`。** 新建弹窗默认选中「文献」，存成 `materialKind: other` 加 `customTag: 文献`。`list_libraries` 只返回 `kind: other`，看不到「文献」。
- **控制接口建库只认固定分类。** `manage_library` 的 `create` 必须带 `kind`。素材库实测 `character` 可用，`general`、`skill` 被拒；技能库 `general` 可用。界面的「自定义标签」在控制接口里没有对应项。
- **绑定弹窗里的复选框，`--role checkbox --name` 匹配不上。** 它的可访问名称和看到的文字不一样（`ui snapshot` 显示的是拼接文字）。用 `--text <库名>` 点整行。
- **删除可恢复。** 删库会移出列表、进回收站，文件夹保留。`data clear --id` 同理。彻底清理用 `env reset`。
- **改条目要带版本。** `write_entry` 必须带 `baseRevision`（先 `read_entry`）。用旧版本写入会被拒，原文不变。
