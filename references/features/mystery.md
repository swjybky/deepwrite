# 剧本杀

验证日期：2026-11-23（测试实例，CLI 驱动）。截图：[工作区](../../test/2026-11-23-feature-map/mystery-workspace.png)、[第一轮搜证](../../test/2026-11-23-feature-map/mystery-clues.png)。

## 1. 功能说明

剧本杀作品分五块：

- 真相与统筹：盘面与世界观、故事真相与核心设计、全局时间线与信息分流表。
- 角色与选角：人物关系网，以及每个角色的「秘密设定 / 公开介绍」。
- 分幕人物本：每个角色每幕的「视角提纲 / 玩家剧本」。
- 线索与演绎：公开开场、各轮搜证、结局真相。
- 主持人手册（DM）。

这类作品的核心约束是信息分流：玩家能看到的内容不能泄露真相。智能体的 `search` 工具可以按 `player_visible` 范围检查泄露。

## 2. 用户路径

1. 新建：「新建书籍」→ 选「剧本杀」标签页 → 填书名并选分类 → 创建。
2. 打开：左侧栏点开带「剧本杀」标签的作品，树下有五个分组：真相与统筹、角色与选角、分幕人物本、线索与演绎、主持人手册。
3. 编辑：展开分组，点文档进入编辑区。结构（角色数、幕数、搜证轮次）在作品管理里调整，入口是作品行「…」→「管理」。

## 3. 前后端对应

**Renderer**

- 主体在 `features/mystery/`：
  - `MysteryEditorPane.vue`、`MysteryOverviewPane.vue`
  - `MysteryStructureManager.vue`
  - `MysteryProposalBanner.vue`
  - `MysteryDialogs.vue`、`ExportMysteryDialog.vue`
- 智能体设置：`MysteryAgentSettingsPanel.vue`、`MysteryAgentTeamSettingsPanel.vue`

**Preload**

`preload/mystery-api.ts`，主要命令：

| 类别 | 命令 |
| --- | --- |
| 建书与打开 | `mystery.createBook`、`mystery.open`、`mystery.list` |
| 读结构 | `mystery.getWorkspaceIndex` |
| 读写文档 | `mystery.readDocument`、`mystery.writeDocument` |
| 结构操作 | `mystery.previewOperations`、`mystery.applyOperations`、`mystery.restoreOperations` |
| 搜索 | `mystery.search` |
| 导出 | `mystery.exportBundle` |
| 绑定 | `mystery.updateBindings` |

**Main 与 Core Utility**

Main 把 `mystery.*` 转给 Core。Core 侧代码在 `utilities/mystery-store/`：

- `project-store.ts`
- `service.ts`
- `catalog.ts`

**智能体**

`packages/pi-runtime-adapter/src/mystery/`：剧本杀工具与可见范围检索。

**磁盘数据**

作品放在 `workspace/mystery-books/<书名>/`，结构如下：

| 路径 | 内容 |
| --- | --- |
| `deepwrite.json` | 作品清单 |
| `AGENTS.md` | 作品级说明 |
| `truth/` | 真相与统筹 |
| `characters/` | 角色与选角 |
| `scripts/` | 分幕人物本 |
| `clues/` | 线索与演绎 |
| `dm/` | 主持人手册 |
| `.deepwrite/` | 作品内部数据 |

注册表：`profile/mystery-projects.json`。

## 4. 用验证 CLI 驱动

**界面：打开某轮搜证**

```bash
pnpm -s ctl ui open --work <剧本杀id>
pnpm -s ctl ui click --label 选择并展开线索与演绎
pnpm -s ctl ui click --role button --name 第一轮搜证      # --text 会同时匹配到概览里的卡片
pnpm -s ctl ui screenshot --out test/<日期-主题>/mystery-round1.png
```

**接口：建作品、写来源、检查信息分流**

```bash
pnpm -s ctl app call manage_work --args '{"action":"create","type":"mystery","title":"样例","genre":"硬核推理"}'
pnpm -s ctl app call get_work --args '{"workId":"<id>"}'        # 默认 6 角色 × 3 幕
pnpm -s ctl app call search_text --args '{"workId":"<id>","query":"19:10"}'
```

`search_text` 返回命中的文档 id 与片段，可以据此核对某个信息是只出现在真相里，还是已经进了线索。

**智能体场景**

```bash
pnpm -s ctl agent scenario mystery
```

这个场景让智能体写第一轮搜证，要求出现 19:10，且不能出现「修复箱」。2026-11-23 实测通过。

## 5. 注意事项

- **分类取值不同。** 剧本杀的分类和短篇不一样，示例里用的是「硬核推理」。完整列表看 `pnpm -s ctl app tools manage_work`。
- **默认结构很大。** 新建后默认 6 个角色、3 幕，`get_work` 会返回约 58 份文档；拿文档 id 时按 title 过滤。
- **防泄露。** 玩家可见的内容（线索、玩家剧本、公开介绍）不能出现真相信息。断言时，用 `agent assert --absent "第一轮搜证=<真相关键词>"` 检查泄露。
- **改结构要确认。** 修改结构（加角色、加幕）走 preview → apply 两步，在作品管理弹窗里完成；控制接口的 `manage_document` 不支持剧本杀结构。
