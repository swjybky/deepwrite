# 智能体单次输出被截断

返回 [ERROR.md](../ERROR.md)。

**症状：**`stopReason: "length"`；子智能体“0 次工具·没有生成可交接的摘要”；重派后用量几乎相同、再次失败。

**根因：**单次输出随书变长（整片名册、整批章节一次提交），超过模型输出上限；截断回复中的工具调用不会执行，原样重发只会重演。

**处理：**

- 按模型配置动态定额：`contracts/src/long-book-decomposition/output-budget.ts` 的 `decompositionCallOutputTokens` 及派生上限。
- 列表型成品用 `batch_mode=partial` 分批暂存，由程序合并，不要求一次交齐。
- 截断交给 `pi-runtime-adapter/src/subagent-reply-guard.ts` 的 `createSubagentReplyGuard`（提示拆小批次），不当作正常结束。

**预防：**用大书规模的夹具测分批路径；新增同类调用时先算最坏输出量。
