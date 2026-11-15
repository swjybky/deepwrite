# 内置提示词改版后旧版被当成自定义

返回 [ERROR.md](../ERROR.md)。

**症状：**更新内置智能体提示词后，老用户仍看到旧提示词，或界面把它标为“已自定义”、不再跟随内置更新。

**根因：**是否为内置提示词按指纹判断（`main/builtin-agent-prompts.ts` 的 `promptFingerprint` / `isBuiltinAgentSystemPrompt`）；改了文本却没登记旧版指纹，用户已保存的旧版本不再被识别。

**处理：**改任何语言的内置提示词时，把改前文本的指纹加入 `LEGACY_PROMPT_FINGERPRINTS` 对应键。

**预防：**`builtin-agent-prompts.test.ts` 覆盖“旧版文本仍被识别为内置”。
