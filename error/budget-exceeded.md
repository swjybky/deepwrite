# 体积与行数预算超限

返回 [ERROR.md](../ERROR.md)。

**症状：**`pnpm build` 报 `Renderer language data exceeds its … B budget`（或 application JS、i18n runtime）；`App.performance.test.ts` 的 `WorkspaceShell.vue` 行数断言（≤ 2800）或 `App.vue`（≤ 25）失败。

**根因：**新功能把文案、订阅或逻辑直接塞进启动包或工作台壳。

**处理：**

- 预算定义在 `tools/check-renderer-build.mjs` 与 `App.performance.test.ts`，未经用户同意不调高。
- 文案精简或放入按需加载的模块；Shell 里的新逻辑移到对应 coordinator / events 路由文件。
- 确需调高时向用户说明当前值、超出量与原因，由用户决定。

**预防：**加文案或改 Shell 后先跑 `pnpm build` 与该测试。
