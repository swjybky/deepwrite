# 跨进程错误显示与分支

返回 [ERROR.md](../ERROR.md)。

**症状：**toast 或界面显示 `[object Object]`；换一种语言或改一句文案后错误处理失效。

**根因：**跨进程错误是结构化的 `ErrorPayload`，被 `String(cause)` 拼成文字，或按 `message` 文本判断错误类型。

**处理：**

- Renderer 用 `renderer/src/i18n/errors.ts` 的 `getErrorPayload` 读取，按 `ErrorPayload.code` 分支、按错误码取本地化文案。
- Main / Utility 新增失败路径时给出稳定的 `code`；外部控制错误码改动同步 `extras/external-control/skill/SKILL.md`。

**预防：**失败路径测试断言 `code`，不断言错误文字。
