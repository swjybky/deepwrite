# 短篇、剧本和长篇 Markdown 导出

## 目标与成功标准

- 短篇、剧集正文支持导出一个 `.md`，含尚未保存的正文编辑。长篇的分文件与合并方式都支持 Markdown，并沿用章节选择和作品顺序。
- 正文保留 Markdown 语法，插图随文导出，跨目录的图片链接可打开。图片缺失时显示提示并完成导出。

## 环境

- macOS Electron 42.5.0。桌面冒烟和界面探针使用独立临时数据目录和合成作品。

## 步骤与命令

- L1 定向 Vitest、改动文件 ESLint 和 Prettier 检查。
- L2 `pnpm typecheck`、`pnpm lint:boundary`、`pnpm build`、`pnpm smoke --book-images-only`。
- 用 Electron 探针打开真实导出弹窗，校验默认选项、Markdown 提交、长篇章节选择和滚动边界。

## 结果

- 13 个测试文件、95 项通过，覆盖格式校验、Markdown 语法、文件顺序、重名、缺图和原有格式。类型、边界和构建预算通过。
- 桌面冒烟通过。短篇 Markdown、长篇分文件和长篇合并通过实际 Preload、Main 和 Core 读取图片，导出链接指向的图片字节与源图一致。
- 左为改前，右为选中 Markdown 的改后。常规窗口可独立选择长篇文件格式和导出方式。最小窗口和 24px 字号下 Markdown 选项与底部操作栏可见，其余内容可滚动。 [浅色常规](2026-11-20-manuscript-markdown-export/compare-light-1200x900-14.png) · [深色常规](2026-11-20-manuscript-markdown-export/compare-dark-1200x900-14.png) · [浅色最小窗口](2026-11-20-manuscript-markdown-export/compare-light-1000x680-24.png) · [深色最小窗口](2026-11-20-manuscript-markdown-export/compare-dark-1000x680-24.png)

## 未覆盖与后续

- Windows 实机未测。macOS 冒烟由夹具提供系统文件对话框的选择结果。
