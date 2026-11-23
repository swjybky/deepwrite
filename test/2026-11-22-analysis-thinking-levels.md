# 修改分析思考等级验收

## 目标与成功标准

温度模式模型在分析页显示「关闭」和模型已配置的思考等级；选择的等级随任务传给 Agent。同一模型刷新后保留有效等级，删除当前等级或切换模型时回到默认值。团队设置接受已配置的等级，并继续拒绝超出选项的等级。

## 环境

macOS，仓库开发版，浅色，窗口 1200 × 800，UI 14px。使用隔离数据目录，通过模型编辑器创建合成自定义模型，服务地址为 `https://example.test/v1`，使用无效占位 Key。保存结果确认 `reasoning: false`、默认 `off`，仍有六档选项。

## 步骤与命令

1. L1 用 `pnpm exec vitest run` 跑五个回归文件，先复现旧行为。修复后用 `pnpm exec vitest related --run` 跑改动入口及 Main 运行校验关联文件。
2. L1/L2 跑 `pnpm exec eslint --max-warnings=0` 和 `pnpm exec prettier --check`（仅本次代码文件），以及 `pnpm lint:boundary`、`pnpm typecheck`、`git diff --check`。
3. L2 通过 Electron 启动检查后运行 `pnpm dev --remoteDebuggingPort 48637`。首次用环境变量传端口时浏览器调试连接报 `curl: (7) Failed to connect to localhost port 48637`，改用命令参数后连接成功。从[更多功能入口](2026-11-22-analysis-thinking-levels/01-入口.png)打开修改分析并选择合成模型，记录[改前下拉框](2026-11-22-analysis-thinking-levels/02-改前.png)。
4. 用相同隔离目录运行 `pnpm dev --remoteDebuggingPort 48637 --inspect 48638`。复现相同操作，记录[改后下拉框](2026-11-22-analysis-thinking-levels/03-改后.png)。填入合成段落并[选择「深度」](2026-11-22-analysis-thinking-levels/04-选中深度.png)，点击「开始分析」并记录[任务已开始](2026-11-22-analysis-thinking-levels/05-提交反馈.png)和[占位端点失败](2026-11-22-analysis-thinking-levels/06-占位端点失败.png)。任务结束后再次展开菜单，[滚动查看其余等级](2026-11-22-analysis-thinking-levels/07-滚动查看其余等级.png)。

## 结果

- 改前只有「关闭」。改后依次显示「关闭、最低、较低、标准、深度、极高、最高」，点击「深度」后控件显示选中值。
- 调试器在 Main 向 Agent Utility 派发处观察到 `agentId: revision-analysis`、请求与派发的等级均为 `high`、模型 `reasoning: false`。
- 占位端点完成重试后进入「分析失败」，输出 `Connection error.`。
- 定向关联测试 34 个文件、289 项通过，ESLint、Prettier、边界、类型及 diff 检查通过。
- 改前回归输出包括 `expected 'off' to be 'medium'` 和「所选模型不支持该思考等级」。修改分析请求测试在设置模型后等待 Vue 更新，模拟用户选择等级的时序。现有切换测试中的温度模式夹具也改为默认 `off`，与保存校验一致。

## 未覆盖与后续

桌面验收覆盖修改分析入口；其余分析页通过共享组件、任务链路核对及定向测试验证。合成端点仅用于发起任务，未验证真实供应商回复或技能保存。共享工作区的 `TEST.md` 已有其他任务的编辑，本次记录保存在本报告。
