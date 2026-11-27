# 导出

验证日期：2026-11-23（测试实例，CLI 驱动到选择格式这一步）。截图：[导出弹窗](../../test/2026-11-23-feature-map/export-dialog.png)。

## 1. 功能说明

把作品正文导出成文件，或者复制到剪贴板。

**正文格式**：
- DOCX 文档：适合继续排版、编辑和打印
- TXT 纯文本
- EPUB 电子书
- Markdown（.md）
- 复制正文：复制全文到剪贴板

**各作品类型的导出**：
- 短篇、剧本、长篇、学术各有正文导出。
- 剧本杀导出成资料包。
- 素材库和技能库可以导出成 ZIP 包。
- 跨电脑全量 / 多选资产迁移（同时导出多部五类作品、素材库、自建技能库及关联分组为单一 `.dwbackup.zip` 并导入到新电脑）：入口位于「设置 → 存储与备份」（详见 `./settings-models.md`；测试模式下可用 `localBackup.setTestDialogPaths` 预设文件对话框路径完成 CLI 端到端验证）。

七个导出入口共用同一个弹窗外壳。

## 2. 用户路径

1. 在左侧栏，把鼠标移到作品行上，行右侧出现「…」（按钮名「<书名>更多操作」），点它，选「导出」。
2. 弹窗「导出正文」：选格式，再点「选择保存位置」，会弹出系统的保存对话框。
3. 资料库：在库行的「…」菜单里选导出；也可以在侧栏顶部的 `+` 菜单里导入素材包。

## 3. 前后端对应

**Renderer**

- 共用外壳：`components/export/`
  - `ExportDialogShell.vue`
  - `ExportOptionCards.vue`
  - `ExportChecklist.vue`
  - `ExportScopeNotice.vue`
  - `ExportLibraryPackageDialog.vue`
- 按类型的弹窗：
  - `ExportAcademicManuscriptDialog.vue`
  - `features/mystery/ExportMysteryDialog.vue`
  - 长篇导出流程：`composables/useLongManuscriptExportFlow.ts`

**Preload 与命令**

| 用途 | 命令 |
| --- | --- |
| 正文导出 | `manuscript.exportShort`、`manuscript.exportLong`、`manuscript.exportAcademic`（`preload/index.ts`） |
| 剧本杀资料包 | `mystery.exportBundle` |
| 资料库 ZIP | `catalog.exportLibraryPackage`（`preload/library-package-api.ts`） |

**Main**

- `main/index.ts` 的 `manuscript.*` 分支：先弹系统保存对话框，再交给 `short-manuscript-export.ts`、`long-manuscript-export.ts`、`academic-manuscript-export.ts` 生成文件。
- 资料库打包：`utilities/library-package/`。

**输入数据**

- 短篇导出的输入：作品引用、标题、格式、小节列表（`packages/contracts/src/short-manuscript-export.ts`），总字数有上限。

## 4. 用验证 CLI 驱动

**界面**（到选格式为止）：

```bash
pnpm -s ctl ui hover --text <书名> --nth 0                 # 「…」按钮只在悬停或选中时出现；打开的作品名也会出现在输入框上方，取第一个（侧栏）
pnpm -s ctl ui click --label <书名>更多操作
pnpm -s ctl ui click --role menuitem --name 导出
pnpm -s ctl ui click --text "TXT 纯文本"
pnpm -s ctl ui screenshot --role dialog --out test/<日期-主题>/export.png
pnpm -s ctl ui press Escape
```

**核对导出内容的来源**：导出读取的是正文文档，可以先回读正文：

```bash
pnpm -s ctl app call read_document --args '{"workId":"<id>","documentId":"draft-section:section-1:body"}'
```

## 5. 注意事项

- **CLI 不能完成整个导出。** 「选择保存位置」会弹出系统原生的保存对话框，Playwright 和 CLI 都驱动不了。要实测文件内容，需要人手动点一次；或者另加一个只在测试模式生效的固定输出目录，目前没有。
- **悬停后才能点「…」。** 作品行的「…」按钮平时不可见，必须先 `ui hover` 到这一行，否则会报 `ui.not_found`。作品已打开时，书名也出现在输入框上方的上下文按钮里，`--text <书名>` 会匹配到两个，用 `--nth 0` 取侧栏那一行。
- **「复制正文」写的是系统剪贴板。** 测试窗口没有焦点时读不到剪贴板，不适合用来自动断言。
- **字数上限。** 正文导出有字数上限（`SHORT_MANUSCRIPT_EXPORT_MAX_CHARACTERS`），超出时契约校验直接失败。
