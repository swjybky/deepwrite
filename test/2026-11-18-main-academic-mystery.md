# 学术写作与剧本杀进入 main 的验证

## 目标与成功标准

- 从已合并的本地代码提交两种工作区及各自的工具枚举修复。保留共用的目录、团队与资料库接入。
- 学术提案重新加载后保留项目版本校验。剧本杀共用目录树，在紧凑窗口下可打开编辑器。

## 环境

基于 `main` 的 `108674b7` 创建隔离工作区。桌面验证使用 Electron 42.5.0、临时用户目录和合成作品。

## 步骤与命令

- L1/L2 定向 Vitest 覆盖学术、剧本杀、工具发包、团队初始化、提案持久化和目录导航。
- L2 在桌面创建并打开学术实证论文和剧本杀，通过目录选择正文档。
- L3 `CI=true DEEPWRITE_TEST_MAX_WORKERS=6 pnpm verify`。

## 结果

- 全量验证通过。1,158 个测试文件中 7,642 项通过，1 项跳过，格式、类型、Lint、边界检查及桌面构建通过。
- 125 项定向回归及 50 项兼容复测通过。桌面会话与资料库分组冒烟通过。
- 学术目录可打开摘要。剧本杀通过公共目录打开真相文档。在 1000×680、24px 的夹具中，编辑区宽 395px，整页无横向溢出。
- 桌面构建通过。Renderer 应用 JS 为 1,230,732 B，沿用本地合并版本的 1,235,000 B 预算。
- [学术正文](2026-11-18-main-academic-mystery/academic-workspace.png) · [剧本杀目录](2026-11-18-main-academic-mystery/mystery-workspace.png) · [紧凑窗口](2026-11-18-main-academic-mystery/mystery-compact.png) · [本地布局前后对照](2026-11-18-main-academic-mystery/mystery-compact-comparison.png)

## 未覆盖与后续

真实模型联网生成与 Windows 安装包验收待补。
