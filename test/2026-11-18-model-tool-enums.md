# 模型工具布尔入参迁移验证

## 目标与成功标准

- 短篇、剧本、长篇、学术写作、剧本杀、资料库、团队管理和拆书工具向模型声明字符串选项，包含由契约生成的嵌套字段。
- 验证默认读取、全文覆盖和多处替换保护、团队审阅、分批暂存、分组移除范围及旧数据读取。

## 环境

本地开发工作区，使用合成夹具、Faux 响应及 Pi SDK。发包检查在网络传输前捕获请求。

## 步骤与命令

- L1 `pnpm exec vitest run` 定向执行工具 schema、参数拒绝、旧参数提示及映射回归。
- L2 `pnpm exec vitest run --maxWorkers=6` 执行全部 Pi adapter 测试及相关 contracts、Main、Utility、MCP 测试。
- L2 `pnpm typecheck`、`pnpm lint:boundary`。改动文件执行 ESLint、Prettier，工作区执行 `git diff --check`。
- L2 `pnpm build`，在独立临时配置中运行桌面分组和拆书冒烟。

## 结果

- 167 个相关文件共 1,437 个用例通过。新增 4 个发包用例通过，覆盖 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages、Gemini 原生协议。
- 短篇、剧本、长篇及学术工具的原生和兼容 schema 通过。剧本杀、资料库、团队管理、拆书角色的工具入参通过布尔字段检查。
- 新枚举映射到原有内部格式。旧分组和团队审阅、已有 MCP 接入、阅读卡持久化回归通过。
- 无效选择无法触发整篇覆盖、批次完成或扩大移除范围。拆书旧 `more` 或显式 `batch_mode: null` 会返回修正提示。
- 类型、边界、ESLint、Prettier、diff 和桌面构建通过。资料库分组及整理桌面冒烟通过。
- 拆书业务冒烟完成。首次界面验证因整书拆解入口默认隐藏而超时，临时启用后通过四个拆书界面步骤，随后附带的预设管理入口检查超时，整套拆书桌面冒烟未通过。

## 未覆盖与后续

真实模型联网回合与安装包验收待补。
