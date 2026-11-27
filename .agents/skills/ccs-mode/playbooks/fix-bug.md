# 修 bug

用途：现有功能表现不对或报错时，先复现并找全根因，做最小修复、重跑验证，并留下可复查的证据。

## 步骤与完成标准

1. **查功能地图并在隔离实例复现问题**
   - 在 `references/features/README.md` 找到所有涉及的功能页（跨模块问题同时查多页，如 `libraries.md` 与 `device-sync.md`），先读「用户路径」「用验证 CLI 驱动」「注意事项」。
   - 运行 `pnpm -s ctl env doctor`（未运行则 `pnpm -s ctl env start`，报 `env.not_seeded` 先 `pnpm -s ctl env seed`），用 `pnpm -s ctl logs mark <标签>` 记下基线；按功能页用 `data load` / `app ipc` / `ui click` / `ui reload` 复现故障（状态损坏类问题只在 `~/.deepwrite-test/default/` 下构造，不碰开发者正式数据）。
   - 用 `pnpm -s ctl ui screenshot --out test/<日期-主题>/01-before.png` 截修复前画面，并用 `pnpm -s ctl logs errors --since <标签>` 记录报错。
   - **完成标准**：在隔离实例上稳定复现出与反馈一致的错误现象或状态并留证（若需先看代码才能确定触发条件，可与第 2 步交叉，但改代码前必须完成复现或说明无法本地复现的原因）。

2. **沿调用链查清完整根因与改动边界**
   - 按功能页「前后端对应」沿 `Renderer → Preload → contracts → Main → Utility → 磁盘数据` 追查源头；不要停留在渲染层兜底文案（如 `renderer/src/i18n/errors.ts`），要定位后端真实报错与上游制造脏状态的入口（如同步失败未回滚、同领域异常项连带阻断正常操作）。
   - 核对影响范围与禁改边界（如跨端共享同步引擎、`AGENTS.md` 分层约束）；若修复方案存在取舍，先用大白话说明根因、要做什么、不做什么与验证标准，等用户确认再改。
   - **完成标准**：能清晰说出触发链、为何现有操作/补救无效、拟改文件清单与不改动边界。

3. **最小修复，先格式化再补回归测试**
   - 只写解决根因的必要代码，保留原有正常路径的保护约束；遵守 `rules/README.md`（优先复用 `@deepwrite/shared/node` 等已有工具，不触发 `no-local-helper` 与 `duplicates` 重复函数规则，注意 `exactOptionalPropertyTypes`）。
   - 先运行 `pnpm exec prettier --write <改动文件>`，再为每个根因环节补单测或集成测试并从仓库根跑 `pnpm exec vitest run <仓库相对测试路径>` 与 `pnpm exec eslint --max-warnings=0 <改动文件>`。
   - **完成标准**：改动精准无顺手重构，定向回归测试、格式与 lint 全部通过。

4. **在隔离测试实例重跑失败场景并收尾**
   - 主进程 / Utility / Preload 有改动时跑 `pnpm -s ctl env restart`（仅界面改动跑 `pnpm -s ctl ui reload`）；重新 `pnpm -s ctl logs mark <标签>` 后，按第 1 步路径完整重跑并验证修复结果。
   - 确认界面提示正确、`ui reload` 后状态持久且不复发，核查 `~/.deepwrite-test/default/` 下对应注册表或文件状态；保存关键步骤与修复后截图到 `test/<日期-主题>/`；跑 `pnpm -s ctl logs errors --since <标签>` 确认无新增错误与警告，结束后跑 `pnpm -s ctl env stop`。
   - **完成标准**：原失败场景完全走通且重载不复发，`logs errors` 干净，前后对比截图落盘（遇 `DEEPWRITE_ELECTRON_SANDBOX` 或缺外部凭据时明确标注受阻项，不以单测替代实测）。

5. **跑统一检查（含脏工作区处理）**
   - 若顺手改了功能入口、命令或路径，先更新 `references/features/` 对应页并跑 `pnpm -s ctl check features`。
   - 工作区混有其他任务未提交改动时优先跑 `pnpm -s ctl check changed --files <本次改动文件>`；干净工作区跑 `pnpm -s ctl check changed`；触及 `packages/contracts/`、根配置、依赖或检查脚本时跑 `pnpm -s ctl check all`。
   - 若未传 `--files` 运行 `check changed` 且失败出在无关脏文件上，先用 `git status` / `git diff` 核实无关，再补跑 `--files <本次改动文件>`；报告时须如实列出无参运行的失败步骤、文件及无关原因（记为未通过，禁止绕过或报成通过）。
   - **完成标准**：定向/对应统一检查输出 `"ok": true`。

6. **评估是否沉淀为工具或规则**
   - 按 `ccs-mode` 的「D. 日常维护」判断该 bug 是否为易复发的同类缺陷：能工具化的优先加进 `tools/control/`；能规则化的加进 lint 或 `pnpm -s ctl check rules` 并在 `rules/README.md` 登记来历；仅属具体业务缺陷时保留回归测试即可。
   - **完成标准**：明确给出结论（已新增工具/规则，或说明为何无需新增）。

7. **给出证据**
   - 回复列出：① 根因与修复文件清单（附路径）及用户侧后续操作；② 跑过的检查命令、是否 `ok`、耗时（未通过时写明失败步骤、文件及无关原因）；③ 隔离测试实例执行过的验证 CLI 命令、关键状态输出（含 `logs errors`）与 `test/<日期-主题>/` 代表性前后截图；④ 未完成或未验证项。
   - **完成标准**：不以口头结论代替验收，回复自带完整可复核证据。
