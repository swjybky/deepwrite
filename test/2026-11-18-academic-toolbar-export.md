# 学术写作工具栏移除下载按钮

## 目标

- 学术文档的编辑和预览工具栏移除下载按钮，书籍菜单继续提供「导出正文」。

## 环境

- macOS Electron 42.5.0，临时用户目录、真实 Vue 组件和合成学术书籍。

## 验证

- L1 运行编辑器、目录菜单、学术导出对话框和导出文件生成相关的 9 个 Vitest 文件，检查 ESLint、Prettier 和 `git diff --check`。
- L2 运行 `pnpm typecheck`。用 Electron `capturePage()` 采集浅色和深色，覆盖 1200 × 850、UI 14 px 与 1000 × 680、UI 24 px。核对编辑及预览工具栏，并通过书籍菜单提交导出。

## 结果

- 110 项定向测试通过，包含 DOCX 和 Markdown 文件写入测试。类型、ESLint、Prettier 和差异检查通过。
- 编辑和预览工具栏均移除下载按钮，其余操作保持单行。短篇、剧本和剧本杀的工具栏采样一致。
- 点击书籍菜单的「导出正文」可打开学术稿件导出对话框并提交学术导出请求。
- 对比图左为改前，右为改后。[浅色常规](2026-11-18-academic-toolbar-export/compare-light-1200x850-14.png) · [深色常规](2026-11-18-academic-toolbar-export/compare-dark-1200x850-14.png) · [浅色窄窗](2026-11-18-academic-toolbar-export/compare-light-1000x680-24.png) · [深色窄窗](2026-11-18-academic-toolbar-export/compare-dark-1000x680-24.png)

## 覆盖范围

- 桌面探针用测试替身接收导出请求。文件写入由 Main 层测试覆盖。
