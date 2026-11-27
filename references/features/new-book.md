# 新建书籍

验证日期：2026-11-23（测试实例，CLI 全程驱动）。截图：[弹窗](../../test/2026-11-23-feature-map/new-book-dialog.png)、[建好后](../../test/2026-11-23-feature-map/new-book-created.png)。

## 1. 功能说明

在创作空间新建一部作品。可选五种类型：短篇、剧本、长篇、学术写作、剧本杀。可同时填写分类，绑定技能库、素材库和智能体团队。

建好后：
- 工作目录下多出一个作品文件夹；
- 左侧栏「创作空间」多出一条。

模板新建（「从模板新建」）走另一个弹窗 `CreateBookFromTemplateDialog.vue`，本页不覆盖。

## 2. 用户路径

1. 打开新建弹窗，两种方式：
   - 点左侧栏顶部「新建书籍」；
   - 按快捷键 `Meta+N` 或 `Control+N`（实测两者都能打开）。
2. 在弹窗「新建短篇书籍」里依次操作：
   - 「创作类型」选标签页：短篇 / 剧本 / 长篇 / 学术写作 / 剧本杀；
   - 「书籍信息」填书名，点一个分类。短篇和剧本的分类是：世情、追妻、科幻、悬疑、其他。
3. 可选：绑定技能库、关联素材库、绑定智能体团队。
4. 点「创建书籍」。弹窗关闭，左侧栏出现新作品。

## 3. 前后端对应

**Renderer**
- `components/CreateBookDialog.vue`：弹窗本体。按类型发出 `submit`。
- `composables/useCreativeBookCreation.ts`：开关弹窗。
  - 没有 `window.deepwrite` 时只提示「浏览器预览不能保存」。这就是在 T3 浏览器里打开页面也建不了书的原因。
- `composables/submitCreativeBook.ts`：按类型分流。短篇会补上默认剧情阶段。
- `composables/short-book-creation.ts`：短篇、剧本、学术的创建。
- 长篇与剧本杀由各自的 lifecycle coordinator 创建。
- 弹窗挂载在 `components/WorkspaceDialogLayer.vue`。

**Preload 与契约命令**

| 类型 | IPC | 契约命令 |
| --- | --- | --- |
| 短篇 | `catalog.createShortBook` | `catalog.createShortBook` |
| 剧本 | `catalog.createScriptBook` | `catalog.createScriptBook` |
| 学术 | `catalog.createAcademicBook` | `catalog.createAcademicBook`（`preload/index.ts`） |
| 长篇 | `long.createBook` | `long.createBook`（`preload/long-book-api.ts`） |
| 剧本杀 | `mystery.createBook` | `mystery.createBook`（`preload/mystery-api.ts`） |

**Main**
- `main/index.ts` 的命令路由把 `catalog.*`、`long.*`、`mystery.*` 交给 Core Utility。
- 带 `AtPath` 的变体（指定父目录）由 Main 先处理路径授权。

**Core Utility**
- 短篇、剧本、学术：`utilities/folder-catalog-store.ts` 的 `createShortBook` 等，加上 `utilities/folder-catalog-store/book-creation.ts`。
- 长篇：`utilities/long-project-store.ts`。
- 剧本杀：`utilities/mystery-store/`。

**磁盘数据**（测试实例在 `~/.deepwrite-test/default/`）

短篇、剧本、学术建在 `workspace/books/<书名>/`：
- `deepwrite.json`：清单，含 `id`、`documents[]`、`linkedMaterialIdsByKind`、`linkedSkillIdsByKind`；
- `AGENTS.md`；
- `stages/*.md`：人物设计、剧情设计等阶段文档；
- `stages/draft/<小节>.body.md` 与 `.state.md`：正文与状态。

剧本杀在 `workspace/mystery-books/`。

注册表：
- `profile/catalog-registry.json`：短篇、剧本、学术、资料库；
- `profile/long-project-registry.json`：长篇；
- `profile/mystery-projects.json`：剧本杀。

## 4. 用验证 CLI 驱动

**界面路径**（验证界面本身时用）：

```bash
pnpm -s ctl logs mark --name before-new-book
pnpm -s ctl ui click --role button --name "新建书籍 Ctrl N"     # 或 ui press Meta+n
pnpm -s ctl ui fill --label 书名 --value 样例书名
pnpm -s ctl ui click --text 悬疑                               # 分类
pnpm -s ctl ui click --text 长篇                               # 换类型时；弹窗里的同名文字优先
pnpm -s ctl ui screenshot --role dialog --out test/<日期-主题>/new-book-dialog.png
pnpm -s ctl ui click --role button --name 创建书籍
pnpm -s ctl ui wait --role dialog --gone
```

**核对结果**：

```bash
pnpm -s ctl data list                                  # works 里有新书，记下 id
pnpm -s ctl app call get_work --args '{"workId":"<id>"}'   # 文档结构
pnpm -s ctl logs errors --since before-new-book        # 应为 clean
```

**只需要一部作品、不验界面时**，走控制接口，更快：

```bash
pnpm -s ctl app call manage_work --args '{"action":"create","type":"short","title":"样例","genre":"悬疑"}'
```

## 5. 注意事项

- **分类有固定白名单。** 短篇、剧本只能是 世情 / 追妻 / 科幻 / 悬疑 / 其他。剧本杀有自己的分类，见 `app tools manage_work`。长篇可填任意短标签。传错时控制接口返回 `external.invalid_input`，并列出可选值。
- **重名会自动避开。** 同名书的文件夹会加 `-2`，例如 `雾港来信-2`。核对磁盘时按 `get_work` 返回的 id 找，不要按书名拼路径。
- **删除只是移出列表。** 删除（`data clear` 或界面「删除」）后进回收站，文件夹还在。彻底清理用 `pnpm -s ctl env reset`。
- **新作品的默认文档是空的。** 短篇默认有：
  - 导语和第一节，各带正文与状态；
  - 人物设计；
  - 剧情、导语、细化、视角、大纲等阶段。
  智能体场景需要来源文字时，先用 `write_document` 写入，参考 `data load short`。
- **界面定位提示。** 弹窗打开时，左侧栏也有同名文字（如「长篇」标签），`--text` 会优先取弹窗里的。被遮挡时报 `ui.covered`，按提示先关弹层。
- **控制接口不能给长篇加章节**（`manage_document` 拒绝长篇）。长篇结构改动要走界面或内置智能体。
