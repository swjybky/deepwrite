# 智能体工具参数整批被拒

返回 [ERROR.md](../ERROR.md)。

**症状：**`items.0.data.kind: must have required properties kind`、`must be object`；一项超限整批拒绝并回显全部参数；子智能体卡在 0 完成，token 持续上涨。

**根因：**Pi 在 `execute` 前按工具参数 schema 整批校验；数量、字数、必填项写在 schema 里会让一处小错拒绝整批，报错也不指明哪一项。只直接调 `execute` 的测试覆盖不到这一层。

**处理：**

- schema 只保留结构；数量、字数上限写进字段说明，由 `execute` 逐项 `safeParse` 并返回简短路径报错。
- 可推断字段（如 `kind`）从 schema 去掉，由程序按工具名补齐；可为空的集合不设必填，执行时补空。
- 模型工具的开关用含义明确的字符串枚举，包括从 Zod 生成的嵌套参数。通过校验后再转换成内部值，避免将无效值解释为覆盖、完成批次或扩大移除范围的授权。
- 常见格式偏差在 `prepareArguments` 修复（参考 `long-book-decomposition/submission-schema.ts`、`submissions.ts`）。
- 出错把错误回给模型重交，不直接终止子任务。

**预防：**工具测试经过参数校验层，至少各覆盖一个超限项、缺字段、字段错位的输入。
